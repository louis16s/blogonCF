import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);

async function loadWorker() {
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const assets = { fetch: async () => new Response("Not found", { status: 404 }) };
const context = { waitUntil() {}, passThroughOnException() {} };

function createRateLimitDb() {
  const rows = new Map();
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...params) { values = params; return this; },
        async first() {
          if (sql.includes("SELECT attempt_count")) return rows.get(values[0]) || null;
          const current = rows.get(values[0]);
          const next = !current || current.window_start <= values[2]
            ? { attempt_count: 1, window_start: values[1] }
            : { ...current, attempt_count: current.attempt_count + 1 };
          rows.set(values[0], next);
          return next;
        },
        async run() {
          if (sql.includes("WHERE key =")) rows.delete(values[0]);
          if (sql.includes("window_start <=")) for (const [key, row] of rows) if (row.window_start <= values[0] && key !== values[1]) rows.delete(key);
          return { success: true };
        },
      };
    },
  };
}

test("server-renders a safe loading state without stale Notion content", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: assets }, context);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>louis16s&#x27; blog<\/title>/);
  assert.match(html, /blog 复活啦/);
  assert.match(html, /正在从 Notion 读取文章/);
  assert.doesNotMatch(html, /2026槟城/);
  assert.match(html, /https:\/\/bblog\.530555\.xyz\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("homepage raw HTML contains the live Notion article index, tools, and footer config", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const body = String(init.body || "");
    if (url.includes("/data_sources/config-source/query")) return Response.json({ results: [
      { properties: { "启用": { checkbox: true }, "配置名": { title: [{ plain_text: "AUTHOR" }] }, "配置值": { rich_text: [{ plain_text: "测试作者" }] } } },
      { properties: { "启用": { checkbox: true }, "配置名": { title: [{ plain_text: "SINCE" }] }, "配置值": { rich_text: [{ plain_text: "2021" }] } } },
    ] });
    if (body.includes('"Menu"')) return Response.json({ results: [{ id: "menu", icon: { type: "emoji", emoji: "🧰" }, properties: {
      title: { title: [{ plain_text: "测试工具" }] }, slug: { rich_text: [{ plain_text: "https://tool.example" }] }, summary: { rich_text: [{ plain_text: "外部工具" }] },
    } }] });
    return Response.json({ results: [
      { id: "penang", properties: { title: { title: [{ plain_text: "2026槟城" }] }, slug: { rich_text: [{ plain_text: "Penang" }] }, summary: { rich_text: [] }, category: { select: { name: "旅行游记" } }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [] } } },
      { id: "locked", properties: { title: { title: [{ plain_text: "Y-1" }] }, slug: { rich_text: [{ plain_text: "Y-1" }] }, summary: { rich_text: [] }, category: { select: { name: "输入密码" } }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [{ plain_text: "hidden" }] } } },
      { id: "77777777-7777-4777-8777-777777777777", properties: { title: { title: [{ plain_text: "nikon F3p" }] }, slug: { rich_text: [] }, summary: { rich_text: [] }, category: { select: { name: "相机分享" } }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [] } } },
    ] });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id", NOTION_CONFIG_DATA_SOURCE_ID: "config-source" }, context);
    const html = await response.text();
    assert.match(html, /2026槟城/);
    assert.match(html, /Y-1/);
    assert.match(html, /nikon F3p/);
    assert.match(html, /测试工具/);
    assert.match(html, /测试作者/);
    assert.match(html, /2021/);
  } finally { globalThis.fetch = originalFetch; }
});

test("client refresh failures clear previously verified list and article content", async () => {
  const [blog, article] = await Promise.all([
    readFile(new URL("../app/components/BlogExplorer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ArticleClient.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(blog, /\.catch\(\(\) => \{ setPosts\(\[\]\); setSiteLinks\(\[\]\); setSiteConfig\(DEFAULT_SITE_CONFIG\); setSyncState\("unavailable"\); \}\)/);
  assert.match(article, /passwordRef\.current = ""; setPost\(undefined\); setBlocks\(\[\]\); setLocked\(false\)/);
});

test("HEIC decoding survives signed URL refreshes without repeated work", async () => {
  const article = await readFile(new URL("../app/components/ArticleClient.tsx", import.meta.url), "utf8");
  assert.match(article, /HEIC_DECODE_CONCURRENCY = 3/);
  assert.match(article, /sourceRef\.current = src/);
  assert.match(article, /return `\$\{block\.id\}:\$\{source\.hostname\}\$\{source\.pathname\}`/);
  assert.match(article, /\}, \[identity\]\)/);
  assert.match(article, /if \(skipInitialRefresh\.current\) skipInitialRefresh\.current = false/);
});

test("overview renders every article immediately while retaining search and category filters", async () => {
  const blog = await readFile(new URL("../app/components/BlogExplorer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(blog, /items\.slice\(/);
  assert.match(blog, /\{items\.map\(\(post, index\)/);
  assert.doesNotMatch(blog, /resource-strip|工具与订阅/);
  assert.match(blog, /siteLinks=\{siteLinks\}/);
  const [sidebar, navigationHook] = await Promise.all([
    readFile(new URL("../app/components/SiteSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/useSiteNavigation.ts", import.meta.url), "utf8"),
  ]);
  assert.match(sidebar, /小工具/);
  assert.match(sidebar, /link\.kind === "tool"/);
  assert.match(sidebar, /blog-sidebar-quick-open/);
  assert.match(navigationHook, /\/api\/content\/navigation/);
  assert.doesNotMatch(sidebar, /categories\.slice/);
  assert.match(sidebar, /mobile-tools/);
  assert.match(blog, /const visible = useMemo/);
  assert.match(blog, /category === ALL \|\| post\.category === category/);
  assert.match(blog, /post\.tags/);
  assert.doesNotMatch(blog, /SortMode|最新优先|最早优先|sort-select/);
  assert.doesNotMatch(blog, /同步 Notion 中的跳转菜单/);
  assert.match(blog, /<ContentFooter id="about" siteConfig=\{siteConfig\}/);
});

test("rangefinder intro is brief, session-scoped, skippable, and motion-safe", async () => {
  const [layout, intro, css, asset] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/IntroSequence.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/rangefinder-intro.webp", import.meta.url)),
  ]);
  assert.match(layout, /<IntroSequence \/>/);
  assert.match(intro, /INTRO_DURATION_MS = 2250/);
  assert.match(intro, /sessionStorage/);
  assert.match(intro, /prefers-reduced-motion/);
  assert.match(intro, />跳过<\/button>/);
  assert.match(intro, /rangefinder-intro\.webp/);
  assert.match(css, /@keyframes intro-camera-journey/);
  assert.match(css, /\.site-intro \{ display: none !important; \}/);
  assert.ok(asset.length > 100_000, "intro asset should be a real optimized camera render");
});

test("article raw HTML contains live title, summary, and public Notion content", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes("/children")
    ? Response.json({ results: [{ id: "paragraph", type: "paragraph", has_children: false, paragraph: { rich_text: [{ plain_text: "服务端正文内容", annotations: {} }] } }], has_more: false })
    : Response.json({ results: [{ id: "penang", properties: {
      title: { title: [{ plain_text: "2026槟城" }] }, slug: { rich_text: [{ plain_text: "Penang" }] }, summary: { rich_text: [{ plain_text: "南洋旧梦" }] }, category: { select: { name: "旅行游记" } }, tags: { multi_select: [{ name: "旅行" }] }, date: { date: { start: "2026-07-12" } }, password: { rich_text: [] },
    } }] });
  try {
    const response = await worker.fetch(new Request("http://localhost/blog/Penang", { headers: { accept: "text/html" } }), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    const html = await response.text();
    assert.match(html, /<title>2026槟城 · louis16s&#x27; blog<\/title>/);
    assert.match(html, /<meta name="description" content="南洋旧梦"/);
    assert.match(html, /<h1>2026槟城<\/h1>/);
    assert.match(html, /服务端正文内容/);
    assert.doesNotMatch(html, /正在从 Notion 读取文章/);
  } finally { globalThis.fetch = originalFetch; }
});

test("locked article raw HTML renders only its password gate", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ results: [{ id: "locked", properties: {
    title: { title: [{ plain_text: "私密文章" }] }, slug: { rich_text: [{ plain_text: "private" }] }, summary: { rich_text: [{ plain_text: "公开摘要" }] }, category: { select: { name: "输入密码" } }, tags: { multi_select: [] }, date: { date: { start: "2026-01-01" } }, password: { rich_text: [{ plain_text: "secret" }] },
  } }] }); };
  try {
    const response = await worker.fetch(new Request("http://localhost/blog/private", { headers: { accept: "text/html" } }), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    const html = await response.text();
    assert.match(html, /<title>私密文章 · louis16s&#x27; blog<\/title>/);
    assert.match(html, /这篇文章需要密码/);
    assert.doesNotMatch(html, /绝密正文不得泄露/);
    assert.equal(calls, 1, "locked SSR must not fetch block children");
  } finally { globalThis.fetch = originalFetch; }
});

test("missing article raw HTML returns a real 404", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ results: [] });
  try {
    const response = await worker.fetch(new Request("http://localhost/blog/missing-post", { headers: { accept: "text/html" } }), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.equal(response.status, 404);
    assert.match(await response.text(), /404|not found/i);
  } finally { globalThis.fetch = originalFetch; }
});

test("article raw HTML preserves Notion upstream failure status", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ message: "upstream unavailable" }, { status: 503 });
  try {
    const response = await worker.fetch(new Request("http://localhost/blog/unavailable-post", { headers: { accept: "text/html" } }), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.equal(response.status, 502);
    assert.match(await response.text(), /文章暂时无法读取/);
  } finally { globalThis.fetch = originalFetch; }
});

test("content endpoint follows Notion pagination cursors", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const bodies = [];
  const page = (id, slug) => ({ id, created_time: "2026-01-01T00:00:00Z", properties: {
    title: { title: [{ plain_text: slug }] }, slug: { rich_text: [{ plain_text: slug }] }, summary: { rich_text: [] }, category: { select: null }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [] },
  } });
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("fffad771-48f4-8181-b48e-000b8cf60e1b")) return Response.json({ results: [], has_more: false });
    const body = JSON.parse(init.body);
    if (body.filter.and.some((item) => item.or)) return Response.json({ results: [], has_more: false });
    bodies.push(body);
    return bodies.length === 1 ? Response.json({ results: [page("a", "a")], has_more: true, next_cursor: "cursor-2" }) : Response.json({ results: [page("b", "b")], has_more: false });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/content/posts"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    const payload = await response.json();
    assert.deepEqual(payload.posts.map((post) => post.slug), ["a", "b"]);
    assert.equal(bodies[0].start_cursor, undefined);
    assert.equal(bodies[1].start_cursor, "cursor-2");
  } finally { globalThis.fetch = originalFetch; }
});

test("sitemap is generated from current Published posts and safely degrades", async () => {
  const worker = await loadWorker();
  const safe = await worker.fetch(new Request("http://localhost/sitemap.xml"), { ASSETS: assets }, context);
  const safeXml = await safe.text();
  assert.match(safeXml, /https:\/\/bblog\.530555\.xyz\/<\/loc>/);
  assert.doesNotMatch(safeXml, /\/blog\//);
  const head = await worker.fetch(new Request("http://localhost/sitemap.xml", { method: "HEAD" }), { ASSETS: assets }, context);
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-type"), /application\/xml/);
  assert.equal(await head.text(), "");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ results: [{ id: "sitemap-page", properties: {
    title: { title: [{ plain_text: "站点文章" }] }, slug: { rich_text: [{ plain_text: "a & b" }] }, summary: { rich_text: [] }, category: { select: null }, tags: { multi_select: [] }, date: { date: { start: "2026-03-04" } }, password: { rich_text: [] },
  } }], has_more: false });
  try {
    const response = await worker.fetch(new Request("http://localhost/sitemap.xml"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    const xml = await response.text();
    assert.match(xml, /\/blog\/a%20%26%20b<\/loc>/);
    assert.match(xml, /<lastmod>2026-03-04<\/lastmod>/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally { globalThis.fetch = originalFetch; }
});

test("RSS is generated from current Published posts and safely degrades", async () => {
  const worker = await loadWorker();
  const safe = await worker.fetch(new Request("http://localhost/rss.xml"), { ASSETS: assets }, context);
  assert.equal(safe.status, 200);
  assert.match(safe.headers.get("content-type"), /application\/rss\+xml/);
  assert.doesNotMatch(await safe.text(), /<item>/);
  const head = await worker.fetch(new Request("http://localhost/rss.xml", { method: "HEAD" }), { ASSETS: assets }, context);
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-type"), /application\/rss\+xml/);
  assert.equal(await head.text(), "");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ results: [{ id: "rss-page", created_time: "2026-01-01T00:00:00Z", properties: {
    title: { title: [{ plain_text: "旅行 & 开发" }] }, slug: { rich_text: [{ plain_text: "rss post" }] }, summary: { rich_text: [{ plain_text: "摘要 <测试>" }] }, category: { select: { name: "旅行游记" } }, tags: { multi_select: [] }, date: { date: { start: "2026-03-04" } }, password: { rich_text: [] },
  } }], has_more: false });
  try {
    const response = await worker.fetch(new Request("http://localhost/rss.xml"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    const xml = await response.text();
    assert.match(xml, /<title>旅行 &amp; 开发<\/title>/);
    assert.match(xml, /\/blog\/rss%20post<\/link>/);
    assert.match(xml, /摘要 &lt;测试&gt;/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally { globalThis.fetch = originalFetch; }
});

test("health endpoint reports missing Notion configuration without leaking secrets", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/health"), { ASSETS: assets }, context);
  assert.deepEqual(await response.json(), { ok: true, notionConfigured: false });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("Notion HEIC files use the same-origin conversion endpoint", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const source = "https://prod-files-secure.s3.us-west-2.amazonaws.com/workspace/photo.HEIC?signature=test";
  globalThis.fetch = async (input) => String(input).includes("/children")
    ? Response.json({ results: [
      { id: "heic", type: "image", has_children: false, image: { type: "file_upload", file: { url: source }, caption: [] } },
      { id: "external-heic", type: "image", has_children: false, image: { type: "external", external: { url: "https://images.example.com/photo.heic" }, caption: [] } },
    ], has_more: false })
    : Response.json({ results: [{ id: "photo-page", properties: {
      title: { title: [{ plain_text: "照片" }] }, slug: { rich_text: [{ plain_text: "photo" }] }, summary: { rich_text: [] }, category: { select: null }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [] },
    } }] });
  try {
    const response = await worker.fetch(new Request("http://localhost/api/content/post/photo"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    const payload = await response.json();
    assert.match(payload.blocks[0].url, /^\/_notion\/image\?url=/);
    assert.equal(new URL(payload.blocks[0].url, "http://localhost").searchParams.get("url"), source);
    assert.equal(payload.blocks[1].url, "https://images.example.com/photo.heic", "non-allowlisted external images must not be proxied");
  } finally { globalThis.fetch = originalFetch; }
});

test("Notion image gateway proxies allowlisted HEIC and rejects SSRF hosts", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async (input, init) => {
    fetches++;
    assert.equal(new URL(String(input)).hostname, "prod-files-secure.s3.us-west-2.amazonaws.com");
    assert.equal(init.redirect, "manual");
    return new Response("heic-binary", { headers: { "content-type": "image/heic" } });
  };
  try {
    const source = encodeURIComponent("https://prod-files-secure.s3.us-west-2.amazonaws.com/workspace/photo.heic?signature=test");
    const response = await worker.fetch(new Request(`http://localhost/_notion/image?url=${source}`), { ASSETS: assets }, context);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/heic");
    assert.equal(response.headers.get("cache-control"), "public, max-age=3600, stale-while-revalidate=86400");
    assert.equal(await response.text(), "heic-binary");

    const blocked = await worker.fetch(new Request("http://localhost/_notion/image?url=https%3A%2F%2Fexample.com%2Fprivate.heic"), { ASSETS: assets }, context);
    assert.equal(blocked.status, 400);
    assert.equal(fetches, 1, "blocked hosts must never be fetched");
  } finally { globalThis.fetch = originalFetch; }
});

test("Notion image gateway rejects non-image upstream payloads", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not-an-image", { headers: { "content-type": "text/html" } });
  try {
    const source = encodeURIComponent("https://prod-files-secure.s3.us-west-2.amazonaws.com/workspace/photo.heic?signature=test");
    const response = await worker.fetch(new Request(`http://localhost/_notion/image?url=${source}`), { ASSETS: assets }, context);
    assert.equal(response.status, 415);
    assert.deepEqual(await response.json(), { error: "Unsupported image response" });
  } finally { globalThis.fetch = originalFetch; }
});

test("content endpoint maps only the filtered Notion response and disables caching", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (input, init) => {
    assert.equal(init.headers.authorization, "Bearer test-token");
    if (String(input).includes("fffad771-48f4-8181-b48e-000b8cf60e1b")) return Response.json({ results: [
      { id: "author", properties: { "启用": { checkbox: true }, "配置名": { title: [{ plain_text: "AUTHOR" }] }, "配置值": { rich_text: [{ plain_text: "Notion 作者" }] }, "其他私密项": { rich_text: [{ plain_text: "不得输出" }] } } },
      { id: "since", properties: { "启用": { checkbox: true }, "配置名": { title: [{ plain_text: "`SINCE`" }] }, "配置值": { rich_text: [{ plain_text: "始于 2019 年" }] } } },
      { id: "disabled", properties: { "启用": { checkbox: false }, "配置名": { title: [{ plain_text: "AUTHOR" }] }, "配置值": { rich_text: [{ plain_text: "禁用作者" }] } } },
    ] });
    assert.match(String(input), /\/v1\/data_sources\/source-id\/query$/);
    const body = JSON.parse(init.body);
    if (body.filter.and.some((item) => item.or)) return Response.json({ results: [
      { id: "rss", properties: { title: { title: [{ plain_text: "RSS" }] }, slug: { rich_text: [{ plain_text: "rss/feed.xml" }] }, summary: { rich_text: [{ plain_text: "订阅" }] }, icon: { rich_text: [] } } },
      { id: "tool", icon: { type: "emoji", emoji: "👾" }, properties: { title: { title: [{ plain_text: "超焦距" }] }, slug: { rich_text: [{ plain_text: "https://hd.530555.xyz" }] }, summary: { rich_text: [{ plain_text: "跳转hd" }] }, icon: { rich_text: [] } } },
      { id: "annotated", properties: { title: { title: [{ plain_text: "带跳转的工具" }] }, slug: { rich_text: [{ plain_text: "links" }] }, summary: { rich_text: [{ plain_text: "Notion 注释链接", href: "https://annotated.example" }] }, icon: { rich_text: [] } } },
      { id: "archive", properties: { type: { select: { name: "Menu" } }, title: { title: [{ plain_text: "历史归档" }] }, slug: { rich_text: [{ plain_text: "/archive" }] }, summary: { rich_text: [] }, icon: { rich_text: [] } } },
      { id: "broken", properties: { title: { title: [{ plain_text: "资讯" }] }, slug: { rich_text: [{ plain_text: "links" }] }, summary: { rich_text: [] }, icon: { rich_text: [] } } },
    ] });
    requestBody = body;
    return Response.json({ results: [{ id: "page-1", created_time: "2026-01-01T00:00:00Z", icon: { type: "emoji", emoji: "✦" }, properties: {
      title: { title: [{ plain_text: "公开文章" }] }, slug: { rich_text: [{ plain_text: "public-post" }] }, summary: { rich_text: [{ plain_text: "摘要" }] },
      category: { select: { name: "旅行游记" } }, tags: { multi_select: [{ name: "旅行" }] }, date: { date: { start: "2026-01-02" } }, password: { rich_text: [] },
    } }] });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/content/posts"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const payload = await response.json();
    assert.equal(payload.posts[0].slug, "public-post");
    assert.deepEqual(payload.posts[0].tags, ["旅行"]);
    assert.deepEqual(payload.links.map((link) => [link.title, link.href, link.kind]), [["RSS", "/rss.xml", "rss"], ["超焦距", "https://hd.530555.xyz", "tool"], ["带跳转的工具", "https://annotated.example", "tool"], ["历史归档", "/#archive", "nav"]]);
    assert.deepEqual(payload.config, { author: "Notion 作者", since: "2019" });
    assert.doesNotMatch(JSON.stringify(payload), /不得输出|禁用作者/);
    assert.deepEqual(requestBody.filter.and.map((item) => item.property), ["type", "status"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("navigation endpoint returns only live Notion-configured jump links", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ results: [
    { id: "tool", icon: { type: "emoji", emoji: "🧭" }, properties: { title: { title: [{ plain_text: "导航工具" }] }, slug: { rich_text: [{ plain_text: "打开", href: "https://nav.example" }] }, summary: { rich_text: [] } } },
    { id: "uppercase-url", properties: { type: { select: { name: "SubMenu" } }, title: { title: [{ plain_text: "URL 属性工具" }] }, slug: { rich_text: [{ plain_text: "tool" }] }, URL: { url: "https://uppercase.example/tool" }, summary: { rich_text: [] } } },
    { id: "invalid", properties: { title: { title: [{ plain_text: "无效跳转" }] }, slug: { rich_text: [{ plain_text: "javascript:alert(1)" }] }, summary: { rich_text: [] } } },
  ] });
  try {
    const response = await worker.fetch(new Request("http://localhost/api/content/navigation"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { links: [
      { id: "tool", title: "导航工具", href: "https://nav.example", summary: "", icon: "🧭", external: true, kind: "tool" },
      { id: "uppercase-url", title: "URL 属性工具", href: "https://uppercase.example/tool", summary: "", icon: "", external: true, kind: "tool" },
    ], source: "notion" });
  } finally { globalThis.fetch = originalFetch; }
});

test("public config endpoint exposes only the AUTHOR and SINCE allowlist", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /\/v1\/data_sources\/config-source\/query$/);
    return Response.json({ results: [
      { properties: { "启用": { checkbox: true }, "配置名": { title: [{ plain_text: "AUTHOR" }] }, "配置值": { rich_text: [{ plain_text: "louis16s" }] } } },
      { properties: { "启用": { checkbox: true }, "配置名": { title: [{ plain_text: "SINCE" }] }, "配置值": { rich_text: [{ plain_text: "2020" }] } } },
      { properties: { "启用": { checkbox: true }, "配置名": { title: [{ plain_text: "SECRET" }] }, "配置值": { rich_text: [{ plain_text: "never-leak" }] } } },
    ] });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/content/config"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_CONFIG_DATA_SOURCE_ID: "config-source" }, context);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { config: { author: "louis16s", since: "2020" }, source: "notion" });
  } finally { globalThis.fetch = originalFetch; }
});

test("password-protected articles never return blocks before successful unlock", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ results: [{ id: "private-page", created_time: "2026-01-01T00:00:00Z", properties: {
      title: { title: [{ plain_text: "私密文章" }] }, slug: { rich_text: [{ plain_text: "private" }] }, summary: { rich_text: [] }, category: { select: { name: "心情随笔" } }, tags: { multi_select: [] }, date: { date: { start: "2026-01-01" } }, password: { rich_text: [{ plain_text: "correct" }] },
    } }] });
  };
  try {
    const env = { ASSETS: assets, DB: createRateLimitDb(), NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" };
    const locked = await worker.fetch(new Request("http://localhost/api/content/post/private"), env, context);
    assert.equal(locked.status, 200);
    assert.deepEqual(await locked.json(), { post: { id: "private-page", title: "私密文章", slug: "private", summary: "", category: "心情随笔", tags: [], date: "2026-01-01", icon: "", locked: true }, locked: true });
    assert.equal(calls, 1, "block children must not be requested while locked");

    const wrong = await worker.fetch(new Request("http://localhost/api/content/post/private", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "wrong" }) }), env, context);
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.json()).error, "密码不正确");
  } finally { globalThis.fetch = originalFetch; }
});

test("correct password unlocks normalized content", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes("/children")
    ? Response.json({ results: [{ id: "block-1", type: "paragraph", has_children: false, paragraph: { rich_text: [{ plain_text: "正文内容", annotations: {} }] } }], has_more: false })
    : Response.json({ results: [{ id: "unlock-page", properties: {
      title: { title: [{ plain_text: "可解锁文章" }] }, slug: { rich_text: [{ plain_text: "unlock" }] }, summary: { rich_text: [] }, category: { select: null }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [{ plain_text: "correct" }] },
    } }] });
  try {
    const response = await worker.fetch(new Request("http://localhost/api/content/post/unlock", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.1" }, body: JSON.stringify({ password: "correct" }) }), { ASSETS: assets, DB: createRateLimitDb(), NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.locked, false);
    assert.equal(payload.blocks[0].richText[0].text, "正文内容");
  } finally { globalThis.fetch = originalFetch; }
});

test("locked article keeps child-page references without eagerly expanding their bodies", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const childRequests = [];
  const childPageId = "55555555-5555-4555-8555-555555555555";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/blocks/locked-index/children")) return Response.json({ results: [
      { id: "toggle", type: "toggle", has_children: true, toggle: { rich_text: [{ plain_text: "章节", annotations: {} }], color: "blue_background" } },
      { id: "after", type: "paragraph", has_children: false, paragraph: { rich_text: [{ plain_text: "索引结尾", annotations: { underline: true } }] } },
    ], has_more: false });
    if (url.includes("/blocks/toggle/children")) return Response.json({ results: [
      { id: childPageId, type: "child_page", has_children: true, child_page: { title: "第一章" } },
      { id: "inside", type: "paragraph", has_children: false, paragraph: { rich_text: [{ plain_text: "更多章节", annotations: {} }] } },
    ], has_more: false });
    if (url.includes(`/blocks/${childPageId}/children`)) { childRequests.push(url); return Response.json({ results: [{ id: "secret-body", type: "paragraph", paragraph: { rich_text: [{ plain_text: "不应内联展开", annotations: {} }] } }] }); }
    return Response.json({ results: [{ id: "locked-index", properties: {
      title: { title: [{ plain_text: "目录文章" }] }, slug: { rich_text: [{ plain_text: "index" }] }, summary: { rich_text: [] }, category: { select: { name: "输入密码" } }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [{ plain_text: "correct" }] },
    } }] });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/content/post/index", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct" }) }), { ASSETS: assets, DB: createRateLimitDb(), NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.blocks.map((block) => block.id), ["toggle", "after"]);
    assert.deepEqual(payload.blocks[0].children.map((block) => block.id), [childPageId, "inside"]);
    assert.equal(payload.blocks[0].children[0].caption, "第一章");
    assert.equal(payload.blocks[0].children[0].pageId, childPageId);
    assert.equal(payload.blocks[0].children[0].url, undefined);
    assert.equal(payload.blocks[0].color, "blue_background");
    assert.equal(payload.blocks[1].richText[0].underline, true);
    assert.deepEqual(childRequests, [], "child-page bodies must not consume the parent article block budget");
  } finally { globalThis.fetch = originalFetch; }
});

test("child pages stay on-site, inherit the parent password, and enforce ancestry", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const parentId = "22222222-2222-4222-8222-222222222222";
  const childId = "11111111-1111-4111-8111-111111111111";
  const nestedId = "66666666-6666-4666-8666-666666666666";
  const intermediateId = "99999999-9999-4999-8999-999999999999";
  const referencedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const nestedReferenceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const richReferenceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const outsideId = "33333333-3333-4333-8333-333333333333";
  let childBlockRequests = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes(`/pages/${childId}`)) return Response.json({ id: childId, parent: { type: "page_id", page_id: parentId }, icon: { type: "emoji", emoji: "📖" }, properties: { title: { type: "title", title: [{ plain_text: "第一章" }] } } });
    if (url.includes(`/pages/${nestedId}`)) return Response.json({ id: nestedId, parent: { type: "page_id", page_id: intermediateId }, properties: { title: { type: "title", title: [{ plain_text: "嵌套章节" }] } } });
    if (url.includes(`/pages/${intermediateId}`)) return Response.json({ id: intermediateId, parent: { type: "page_id", page_id: parentId }, properties: { title: { type: "title", title: [{ plain_text: "中间章节" }] } } });
    if (url.includes(`/pages/${referencedId}`)) return Response.json({ id: referencedId, parent: { type: "workspace", workspace: true }, properties: { title: { type: "title", title: [{ plain_text: "同步块引用页" }] } } });
    if (url.includes(`/pages/${nestedReferenceId}`)) return Response.json({ id: nestedReferenceId, parent: { type: "workspace", workspace: true }, properties: { title: { type: "title", title: [{ plain_text: "引用页的下一级" }] } } });
    if (url.includes(`/pages/${richReferenceId}`)) return Response.json({ id: richReferenceId, parent: { type: "workspace", workspace: true }, properties: { title: { type: "title", title: [{ plain_text: "富文本引用页" }] } } });
    if (url.includes(`/pages/${outsideId}`)) return Response.json({ id: outsideId, parent: { type: "page_id", page_id: "44444444-4444-4444-8444-444444444444" }, properties: { title: { type: "title", title: [{ plain_text: "不属于本文" }] } } });
    if (url.includes(`/pages/44444444-4444-4444-8444-444444444444`)) return Response.json({ id: "44444444-4444-4444-8444-444444444444", parent: { type: "workspace", workspace: true }, properties: {} });
    if (url.includes(`/blocks/${childId}/children`)) {
      childBlockRequests++;
      return Response.json({ results: [{ id: "child-paragraph", type: "paragraph", has_children: false, paragraph: { rich_text: [{ plain_text: "站内子页面正文", annotations: {} }] } }], has_more: false });
    }
    if (url.includes(`/blocks/${nestedId}/children`)) { childBlockRequests++; return Response.json({ results: [], has_more: false }); }
    if (url.includes(`/blocks/${parentId}/children`)) return Response.json({ results: [
      { id: referencedId, type: "child_page", has_children: true, child_page: { title: "同步块引用页" } },
      { id: "rich-link", type: "paragraph", has_children: false, paragraph: { rich_text: [{ plain_text: "富文本引用", href: `https://app.notion.com/p/${richReferenceId.replaceAll("-", "")}`, annotations: {} }] } },
    ], has_more: false });
    if (url.includes(`/blocks/${referencedId}/children`)) { childBlockRequests++; return Response.json({ results: [{ id: nestedReferenceId, type: "child_page", has_children: true, child_page: { title: "引用页的下一级" } }], has_more: false }); }
    if (url.includes(`/blocks/${nestedReferenceId}/children`)) { childBlockRequests++; return Response.json({ results: [], has_more: false }); }
    if (url.includes(`/blocks/${richReferenceId}/children`)) { childBlockRequests++; return Response.json({ results: [], has_more: false }); }
    return Response.json({ results: [{ id: parentId, properties: {
      title: { title: [{ plain_text: "目录文章" }] }, slug: { rich_text: [{ plain_text: "index" }] }, summary: { rich_text: [] }, category: { select: { name: "输入密码" } }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [{ plain_text: "correct" }] },
    } }] });
  };
  const env = { ASSETS: assets, DB: createRateLimitDb(), NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" };
  try {
    const missing = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "index", pageId: childId }) }), env, context);
    assert.equal(missing.status, 403);
    assert.equal(childBlockRequests, 0, "a missing parent password must never fetch child content");

    const wrong = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "index", pageId: childId, password: "wrong" }) }), env, context);
    assert.equal(wrong.status, 401);
    assert.equal(childBlockRequests, 0, "a wrong parent password must never fetch child content");

    const correct = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "index", pageId: childId, password: "correct" }) }), env, context);
    assert.equal(correct.status, 200);
    assert.equal(correct.headers.get("cache-control"), "no-store");
    assert.deepEqual(await correct.json(), { child: { id: childId, title: "第一章", icon: "📖", blocks: [{ id: "child-paragraph", type: "paragraph", richText: [{ text: "站内子页面正文" }] }], truncated: false } });
    assert.equal(childBlockRequests, 1);

    const nested = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "index", pageId: nestedId, password: "correct" }) }), env, context);
    assert.equal(nested.status, 200);
    assert.equal((await nested.json()).child.id, nestedId, "nested ancestry must return the requested page rather than its intermediate parent");
    assert.equal(childBlockRequests, 2);

    const referenced = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "index", pageId: referencedId, password: "correct" }) }), env, context);
    assert.equal(referenced.status, 200, "a page explicitly referenced by unlocked parent blocks must remain available on-site");
    assert.equal((await referenced.json()).child.title, "同步块引用页");

    const nestedReference = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "index", pageId: nestedReferenceId, trail: [referencedId], password: "correct" }) }), env, context);
    assert.equal(nestedReference.status, 200, "a nested referenced page must be authorized through the verified trail");
    assert.equal((await nestedReference.json()).child.title, "引用页的下一级");

    const richReference = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "index", pageId: richReferenceId, password: "correct" }) }), env, context);
    assert.equal(richReference.status, 200, "a Notion page linked from rich text must remain available on-site");
    assert.equal((await richReference.json()).child.title, "富文本引用页");

    const outside = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "index", pageId: outsideId, password: "correct" }) }), env, context);
    assert.equal(outside.status, 404);
    assert.equal(childBlockRequests, 6, "non-descendant and unreferenced pages must never expose their blocks");
  } finally { globalThis.fetch = originalFetch; }
});

test("a child-page UUID cannot bypass the published article collection", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  let blockRequests = 0;
  globalThis.fetch = async (input) => {
    if (String(input).includes("/blocks/")) blockRequests++;
    return Response.json({ results: [] });
  };
  try {
    const childId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const response = await worker.fetch(new Request(`http://localhost/api/content/post/${childId}`), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.equal(response.status, 404);
    assert.equal(blockRequests, 0, "unpublished or child-page UUIDs must never be read as top-level posts");
  } finally { globalThis.fetch = originalFetch; }
});

test("deep Notion content reports truncation instead of silently pretending to be complete", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    const match = url.match(/\/blocks\/(deep-root|deep-(\d+))\/children/);
    if (match) {
      const depth = match[1] === "deep-root" ? 0 : Number(match[2]) + 1;
      const id = `deep-${depth}`;
      return Response.json({ results: [{ id, type: "paragraph", has_children: true, paragraph: { rich_text: [{ plain_text: `第${depth}层`, annotations: {} }] } }], has_more: false });
    }
    return Response.json({ results: [{ id: "deep-root", properties: { title: { title: [{ plain_text: "深层文章" }] }, slug: { rich_text: [{ plain_text: "deep" }] }, summary: { rich_text: [] }, category: { select: null }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [] } } }] });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/content/post/deep"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).truncated, true);
    const article = await readFile(new URL("../app/components/ArticleClient.tsx", import.meta.url), "utf8");
    assert.match(article, /当前页面可能未完整显示/);
  } finally { globalThis.fetch = originalFetch; }
});

test("published posts without a slug remain reachable through their Notion page ID", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const pageId = "77777777-7777-4777-8777-777777777777";
  const sourceId = "88888888-8888-4888-8888-888888888888";
  let queries = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes(`/data_sources/${sourceId}/query`)) {
      queries++;
      if (queries === 1) return Response.json({ results: [] });
      return Response.json({ results: [{ id: pageId, properties: {
        title: { title: [{ plain_text: "没有 Slug 的文章" }] }, slug: { rich_text: [] }, summary: { rich_text: [] }, category: { select: null }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [] }, type: { select: { name: "Post" } }, status: { select: { name: "Published" } },
      } }] });
    }
    if (url.includes(`/blocks/${pageId}/children`)) return Response.json({ results: [], has_more: false });
    return Response.json({ results: [] });
  };
  try {
    const response = await worker.fetch(new Request(`http://localhost/api/content/post/${pageId}`), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: sourceId }, context);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).post.slug, pageId);
  } finally { globalThis.fetch = originalFetch; }
});

test("article renderer opens child pages internally instead of linking to Notion", async () => {
  const article = await readFile(new URL("../app/components/ArticleClient.tsx", import.meta.url), "utf8");
  assert.match(article, /fetch\("\/api\/content\/child"/);
  assert.match(article, /history\.pushState/);
  assert.match(article, /case "child_page": return block\.pageId/);
  assert.doesNotMatch(article, /case "child_page"[^\n]+notion\.so/);
});

test("password endpoint rate-limits repeated failures before calling Notion again", async () => {
  const workerA = await loadWorker();
  const workerB = await loadWorker();
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ results: [{ id: "limited-page", properties: {
    title: { title: [{ plain_text: "限流文章" }] }, slug: { rich_text: [{ plain_text: "limited" }] }, summary: { rich_text: [] }, category: { select: null }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [{ plain_text: "correct" }] },
  } }] }); };
  try {
    let now = 1_000_000;
    Date.now = () => now;
    const env = { ASSETS: assets, DB: createRateLimitDb(), NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" };
    for (let index = 0; index < 5; index++) {
      const worker = index % 2 ? workerA : workerB;
      const response = await worker.fetch(new Request("http://localhost/api/content/post/limited", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.55" }, body: JSON.stringify({ password: "wrong" }) }), env, context);
      assert.equal(response.status, 401);
    }
    const blocked = await workerB.fetch(new Request("http://localhost/api/content/post/limited", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.55" }, body: JSON.stringify({ password: "wrong" }) }), env, context);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal(calls, 5);
    now += 10 * 60 * 1000 + 1;
    const reset = await workerA.fetch(new Request("http://localhost/api/content/post/limited", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.55" }, body: JSON.stringify({ password: "wrong" }) }), env, context);
    assert.equal(reset.status, 401, "the rolling window resets only after ten minutes from its first failure");
    assert.equal(calls, 6);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
});

test("concurrent correct passwords are never counted as failures", async () => {
  const workerA = await loadWorker();
  const workerB = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes("/children")
    ? Response.json({ results: [], has_more: false })
    : Response.json({ results: [{ id: "concurrent-page", properties: {
      title: { title: [{ plain_text: "并发文章" }] }, slug: { rich_text: [{ plain_text: "concurrent" }] }, summary: { rich_text: [] }, category: { select: null }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [{ plain_text: "correct" }] },
    } }] });
  try {
    const env = { ASSETS: assets, DB: createRateLimitDb(), NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" };
    const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => (index % 2 ? workerA : workerB).fetch(new Request("http://localhost/api/content/post/concurrent", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.77" }, body: JSON.stringify({ password: "correct" }) }), env, context)));
    assert.deepEqual(responses.map((response) => response.status), [200, 200, 200, 200, 200, 200]);
  } finally { globalThis.fetch = originalFetch; }
});

test("Notion failures do not consume password failure quota", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ message: "upstream unavailable" }, { status: 503 });
  try {
    const env = { ASSETS: assets, DB: createRateLimitDb(), NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" };
    for (let index = 0; index < 6; index++) {
      const response = await worker.fetch(new Request("http://localhost/api/content/post/upstream", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.88" }, body: JSON.stringify({ password: "wrong" }) }), env, context);
      assert.equal(response.status, 502);
    }
  } finally { globalThis.fetch = originalFetch; }
});
