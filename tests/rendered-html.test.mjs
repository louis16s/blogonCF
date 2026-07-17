import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);

async function loadWorker() {
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const assets = { fetch: async () => new Response("Not found", { status: 404 }) };
const context = { waitUntil() {}, passThroughOnException() {} };

test("server-renders the finished blog with fallback content and production metadata", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: assets }, context);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>louis16s&#x27; blog<\/title>/);
  assert.match(html, /把经过的地方/);
  assert.match(html, /2026槟城/);
  assert.match(html, /https:\/\/bblog\.530555\.xyz\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
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
    const env = { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" };
    const locked = await worker.fetch(new Request("http://localhost/api/content/post/private"), env, context);
    assert.equal(locked.status, 200);
    assert.deepEqual(await locked.json(), { post: { id: "private-page", title: "私密文章", slug: "private", summary: "", category: "心情随笔", tags: [], date: "2026-01-01", icon: "", locked: true }, locked: true });
    assert.equal(calls, 1, "block children must not be requested while locked");

    const wrong = await worker.fetch(new Request("http://localhost/api/content/post/private", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "wrong" }) }), env, context);
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.json()).error, "密码不正确");
  } finally { globalThis.fetch = originalFetch; }
});
