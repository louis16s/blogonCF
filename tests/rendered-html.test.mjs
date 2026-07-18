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

test("client refresh failures clear previously verified list and article content", async () => {
  const [blog, article] = await Promise.all([
    readFile(new URL("../app/components/BlogExplorer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ArticleClient.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(blog, /\.catch\(\(\) => \{ setPosts\(\[\]\); setSyncState\("unavailable"\); \}\)/);
  assert.match(article, /passwordRef\.current = ""; setPost\(undefined\); setBlocks\(\[\]\); setLocked\(false\)/);
});

test("overview limits each category to one card row without limiting search or category results", async () => {
  const blog = await readFile(new URL("../app/components/BlogExplorer.tsx", import.meta.url), "utf8");
  assert.match(blog, /category === ALL && !query\.trim\(\) \? items\.slice\(0, 4\) : items/);
  assert.match(blog, /const visible = useMemo/);
  assert.match(blog, /category === ALL \|\| post\.category === category/);
  assert.match(blog, /post\.tags/);
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

test("content endpoint follows Notion pagination cursors", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const bodies = [];
  const page = (id, slug) => ({ id, created_time: "2026-01-01T00:00:00Z", properties: {
    title: { title: [{ plain_text: slug }] }, slug: { rich_text: [{ plain_text: slug }] }, summary: { rich_text: [] }, category: { select: null }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [] },
  } });
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body); bodies.push(body);
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

test("content endpoint maps only the filtered Notion response and disables caching", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/v1\/data_sources\/source-id\/query$/);
    assert.equal(init.headers.authorization, "Bearer test-token");
    requestBody = JSON.parse(init.body);
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
    assert.deepEqual(requestBody.filter.and.map((item) => item.property), ["type", "status"]);
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
