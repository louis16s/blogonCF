import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { videoEmbedUrl } from "../shared/videoEmbed.js";

const require = createRequire(import.meta.url);
async function clientExports(hooks = {}, window = {}, globals = {}) {
  const source = await readFile(new URL("../app/components/ArticleClient.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(`${source}\nexport { Rich, ContentPrefetchSentinel, NotionVideo, ChildDatabaseBlock, recordContinuationCursor };`, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, window, ...globals,
    require: (name) => name === "react" ? { ...React, ...hooks }
      : name === "@phosphor-icons/react" ? new Proxy({}, { get: () => () => React.createElement("span") })
      : name === "../../shared/videoEmbed.js" ? { videoEmbedUrl }
      : name.startsWith(".") ? {} : require(name),
    IntersectionObserver: window.IntersectionObserver,
  });
  return exports;
}

test("video providers use fixed player hosts and reject spoofed URLs", () => {
  assert.equal(videoEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(videoEmbedUrl("https://youtu.be/dQw4w9WgXcQ?t=20"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(videoEmbedUrl("https://vimeo.com/1234567"), "https://player.vimeo.com/video/1234567");
  for (const value of ["https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "http://youtu.be/dQw4w9WgXcQ", "https://u:p@youtu.be/dQw4w9WgXcQ"]) assert.equal(videoEmbedUrl(value), "");
});

test("a failed continuation pauses observation until the reader explicitly retries", async () => {
  let observations = 0;
  let loads = 0;
  const effects = [];
  const browser = { IntersectionObserver: class {
    constructor(callback) { this.callback = callback; }
    observe() { observations++; this.callback([{ isIntersecting: true }]); }
    disconnect() {}
  } };
  const { ContentPrefetchSentinel } = await clientExports({ useRef: () => ({ current: {} }), useEffect: (callback) => effects.push(callback) }, browser);
  const onLoad = () => loads++;
  const failed = ContentPrefetchSentinel({ pending: true, loading: false, error: "暂时不可用", onLoad });
  effects.pop()();
  assert.equal(observations, 0);
  assert.equal(loads, 0);
  const alert = failed.props.children;
  const retry = alert.props.children[1];
  retry.props.onClick();
  assert.equal(loads, 1);
  ContentPrefetchSentinel({ pending: true, loading: false, error: "", onLoad });
  effects.pop()();
  assert.equal(observations, 1);
  assert.equal(loads, 2);
});

test("inline equations stay inline and external videos expose a source fallback", async () => {
  const { Rich, NotionVideo } = await clientExports();
  const rich = renderToStaticMarkup(React.createElement(Rich, { value: [{ text: "E=mc^2", equation: "E=mc^2" }], onOpenChild() {} }));
  assert.match(rich, /class="equation-inline"/);
  assert.doesNotMatch(rich, /<div/);
  const video = renderToStaticMarkup(React.createElement(NotionVideo, { block: { url: "https://youtu.be/dQw4w9WgXcQ" }, className: "notion-block" }));
  assert.match(video, /youtube-nocookie.com\/embed/);
  assert.match(video, /打开视频来源/);
  assert.doesNotMatch(video, /<video/);
});

test("database pages merge, stop on errors, and preserve the member authorization trail", async () => {
  const state = [];
  let index = 0;
  let effects = [];
  const hooks = {
    useState(initial) {
      const slot = index++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], (value) => { state[slot] = typeof value === "function" ? value(state[slot]) : value; }];
    },
    useRef(initial) {
      const slot = index++;
      return state[slot] ||= { current: initial };
    },
    useCallback(callback) { return callback; },
    useEffect(callback) { effects.push(callback); },
  };
  const requests = [];
  let fail = true;
  const row = (id) => ({ id, title: `条目 ${id}`, fields: [] });
  const { ChildDatabaseBlock } = await clientExports(hooks, { setTimeout: (callback) => { queueMicrotask(callback); return 0; }, clearTimeout() {} }, { fetch: async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (body.cursor && fail) return Response.json({ error: "稍后重试" }, { status: 503 });
    return Response.json({ database: { id: "database-id", title: "数据库", rows: body.cursor ? [row("row-2"), { ...row("published-row"), href: "/blog/own-password" }] : [row("row-1")], nextCursor: body.cursor ? null : "next-page" } });
  } });
  const opened = [];
  const render = () => {
    index = 0; effects = [];
    return ChildDatabaseBlock({ block: { databaseId: "database-id" }, context: { slug: "root", contentKind: "post", trail: ["parent-id"] }, onOpenChild: (...args) => opened.push(args) });
  };
  let view = render();
  view.props.children[0].props.onClick();
  await new Promise(setImmediate);
  render(); effects.forEach((effect) => effect());
  await new Promise(setImmediate);
  view = render(); effects.forEach((effect) => effect());
  assert.equal(requests.length, 2, "failed auto-pagination must pause");
  assert.equal(requests[1].cursor, "next-page");
  assert.deepEqual([...requests[1].trail], ["parent-id"]);
  fail = false;
  view.props.children.at(-1).props.children[1].props.onClick();
  await new Promise(setImmediate);
  view = render();
  const rows = view.props.children[1].props.children;
  assert.equal(rows.length, 3);
  rows[1].props.children[0].props.children.props.onClick();
  assert.equal(opened[0][0], "row-2");
  assert.deepEqual([...opened[0][3]], ["parent-id"], "database IDs must not be persisted as child-page history entries");
  const publishedLink = rows[2].props.children[0].props.children;
  assert.equal(publishedLink.type, "a");
  assert.equal(publishedLink.props.href, "/blog/own-password", "published articles must navigate through their own password gate");
  assert.equal(publishedLink.props.onClick, undefined);
  effects.forEach((effect) => effect());
  assert.equal(requests.length, 3, "last page must stop fetching");
});

test("continuation cursors reject self-loops and longer cycles while keeping failed cursors retryable", async () => {
  const { recordContinuationCursor } = await clientExports();
  const seen = new Set();
  recordContinuationCursor(seen, "A", "B");
  assert.throws(() => recordContinuationCursor(seen, "B", "A"), /分页没有前进/);
  assert.equal(seen.has("B"), false, "an unsuccessful page must remain explicitly retryable");
  recordContinuationCursor(seen, "B", "C");
  assert.throws(() => recordContinuationCursor(seen, "C", "C"), /分页没有前进/);
  assert.throws(() => recordContinuationCursor(seen, "C", "A"), /分页没有前进/);
  recordContinuationCursor(seen, "C", null);
  assert.throws(() => recordContinuationCursor(seen, "A", "D"), /分页没有前进/);
  seen.clear();
  recordContinuationCursor(seen, "A", null);
});

test("photographic navigation performs no warm HTTP requests and cancels on history restore", async () => {
  const source = await readFile(new URL("../app/components/BlogExplorer.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(`${source}\nexport { PostCard };`, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const effects = [];
  const timers = [];
  const navigations = [];
  const listeners = new Map();
  let requests = 0;
  const hooks = {
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    useRef: (current) => ({ current }),
    useMemo: (callback) => callback(),
    useDeferredValue: (value) => value,
    useCallback: (callback) => callback,
    useEffect: (callback) => effects.push(callback),
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    fetch: () => { requests++; throw new Error("Unexpected warm request"); },
    window: {
      matchMedia: () => ({ matches: false }),
      addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener() {},
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }, clearTimeout() {},
      location: { assign: (href) => navigations.push(href) },
    },
    document: { body: { classList: { add() {}, remove() {} } } },
    require: (name) => name === "react" ? { ...React, ...hooks }
      : name === "next/dynamic" ? { default: () => () => null }
      : name === "@phosphor-icons/react" ? new Proxy({}, { get: () => () => null })
      : name === "../../shared/site-config" ? { siteThemeVariables: () => ({}) }
      : name === "../../shared/wordCloud.js" ? { normalizeSearchText: (value) => value }
      : name.startsWith(".") ? {} : require(name),
  });
  const post = { id: "post", slug: "sample", title: "示例", summary: "", date: "2026-10-13", tags: [], category: "" };
  const tree = exports.BlogExplorer({ initialPosts: [post], initialConfig: { categoriesEnabled: false } });
  effects[0]();
  const findCard = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === exports.PostCard) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = findCard(child);
      if (found) return found;
    }
  };
  const card = findCard(tree);
  assert.ok(card);
  const renderedCard = exports.PostCard(card.props);
  assert.equal(renderedCard.props.onPointerEnter, undefined);
  assert.equal(renderedCard.props.onPointerDown, undefined);
  assert.equal(renderedCard.props.onFocusCapture, undefined);
  const bounds = { top: 0, right: 100, bottom: 100, left: 0, width: 100, height: 100 };
  assert.equal(card.props.onOpen(post, bounds), true);
  assert.equal(requests, 0);
  assert.equal(timers[0].delay, 840);
  listeners.get("pageshow")();
  timers[0].callback();
  await Promise.resolve();
  assert.deepEqual(navigations, [], "restoring the homepage must invalidate suspended navigation");
  assert.equal(card.props.onOpen(post, bounds), true);
  timers[1].callback();
  await Promise.resolve();
  assert.deepEqual(navigations, ["/blog/sample"]);
  assert.equal(requests, 0);
});
