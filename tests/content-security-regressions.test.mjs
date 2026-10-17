import assert from "node:assert/strict";
import test from "node:test";

const root = "11111111-1111-4111-8111-111111111111";
const child = "22222222-2222-4222-8222-222222222222";
const database = "33333333-3333-4333-8333-333333333333";
const source = "44444444-4444-4444-8444-444444444444";
const cursor = "55555555-5555-4555-8555-555555555555";
const member = "66666666-6666-4666-8666-666666666666";
const rich = (text) => ({ rich_text: [{ plain_text: text }] });
const paragraph = (id, text) => ({ id, type: "paragraph", has_children: false, paragraph: { rich_text: [{ plain_text: text }] } });

async function fixture(run, password = "fixture-password") {
  const originalFetch = globalThis.fetch;
  const page = { id: root, object: "page", last_edited_time: "2026-10-13T00:00:00Z", properties: {
    title: { title: [{ plain_text: "Protected fixture" }] }, slug: rich("fixture"), summary: rich(""), password: rich(password),
    type: { select: { name: "Page" } }, status: { select: { name: "Published" } },
  } };
  const databaseQueries = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/data_sources/fixture-config/query")) return Response.json({ results: [], has_more: false });
    if (url.includes("/data_sources/fixture-content/query")) return Response.json({ results: [page], has_more: false });
    if (url.includes(`/pages/${database}`)) return Response.json({ message: "not a page" }, { status: 404 });
    if (url.includes(`/pages/${member}`)) return Response.json({ object: "page", id: member, parent: { data_source_id: source }, properties: { title: { title: [{ plain_text: "Database member" }] } } });
    if (url.endsWith(`/data_sources/${source}`)) return Response.json({ id: source, parent: { database_id: database } });
    if (url.includes(`/pages/${child}`)) return Response.json({ object: "page", id: child, parent: { page_id: root }, properties: { title: { title: [{ plain_text: "Child" }] } } });
    if (url.includes(`/pages/${root}`)) return Response.json(page);
    if (url.includes(`/blocks/${root}/children`)) return Response.json({ results: [paragraph("body", "PRIVATE-FIXTURE-MARKER"), { id: child, type: "child_page", child_page: { title: "Child" } }, { id: database, type: "child_database", child_database: { title: "Database" } }], has_more: false });
    if (url.includes(`/blocks/${child}/children`)) return Response.json({ results: [paragraph("child-body", "CHILD-FIXTURE-MARKER")], has_more: false });
    if (url.includes(`/blocks/${member}/children`)) return Response.json({ results: [paragraph("member-body", "MEMBER-FIXTURE-MARKER")], has_more: false });
    if (url.includes(`/databases/${database}`)) return Response.json({ object: "database", id: database, title: [{ plain_text: "Database" }], data_sources: [{ id: source }] });
    if (url.includes(`/data_sources/${source}/query`)) {
      const body = JSON.parse(init.body);
      databaseQueries.push(body);
      return Response.json({ results: Array.from({ length: body.start_cursor ? 1 : 100 }, (_, i) => ({ id: `row-${body.start_cursor ? 100 : i}`, properties: { Name: { type: "title", title: [{ plain_text: `Row ${i}` }] } } })), has_more: !body.start_cursor, next_cursor: body.start_cursor ? null : cursor });
    }
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  const worker = (await import(`../dist/server/index.js?security=${Math.random()}`)).default;
  const env = { NOTION_TOKEN: "synthetic-test-token", NOTION_DATA_SOURCE_ID: "fixture-content", NOTION_CONFIG_DATA_SOURCE_ID: "fixture-config", DB: {
    prepare(sql) { return { bind() { return this; }, async first() { return sql.includes("request_rate_limits") ? { request_count: 1, window_start: Date.now() } : null; }, async run() { return { success: true }; } }; },
  } };
  const fetch = (path, body, cookie) => worker.fetch(new Request(`http://localhost${path}`, {
    ...(body ? { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) } } : { headers: cookie ? { cookie } : {} }),
  }), env, { waitUntil() {}, passThroughOnException() {} });
  try { await run({ fetch, page, databaseQueries }); }
  finally { globalThis.fetch = originalFetch; }
}

test("password Page gates its body, headings, children, database, RSS and SSR", async () => fixture(async ({ fetch }) => {
  const response = await fetch("/api/content/page/fixture");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json();
  assert.equal(payload.locked, true);
  assert.equal(payload.post.locked, true);
  assert.equal(payload.blocks, undefined);
  assert.equal((await fetch("/api/content/page/fixture?headings=1")).status, 403);
  assert.equal((await fetch("/api/content/page-child", { slug: "fixture", pageId: child })).status, 403);
  assert.equal((await fetch("/api/content/database", { slug: "fixture", databaseId: database, contentKind: "page" })).status, 403);
  assert.equal((await fetch("/api/content/rss-feeds?slug=fixture")).status, 403);
  const html = await fetch("/page/fixture");
  assert.equal(html.headers.get("cache-control"), "private, no-store");
  assert.doesNotMatch(await html.text(), /PRIVATE-FIXTURE-MARKER/);
}));

test("Page unlock works across ID aliases, and changing its password revokes the cookie", async () => fixture(async ({ fetch, page }) => {
  const response = await fetch("/api/content/page/fixture", { password: "fixture-password" });
  assert.equal((await response.json()).locked, false);
  const cookie = response.headers.get("set-cookie").split(";", 1)[0];
  assert.equal((await fetch("/api/content/unlock-session?slug=fixture&kind=page", undefined, cookie)).status, 200);
  assert.equal((await (await fetch(`/api/content/page/${root}`, undefined, cookie)).json()).locked, false);
  assert.equal((await fetch("/api/content/page-child", { slug: "fixture", pageId: child }, cookie)).status, 200);
  page.properties.password = rich("changed-password");
  assert.equal((await (await fetch("/api/content/page/fixture", undefined, cookie)).json()).locked, true);
  assert.equal((await fetch("/api/content/unlock-session?slug=fixture&kind=page", undefined, cookie)).status, 403);
  assert.equal((await fetch("/api/content/page-child", { slug: "fixture", pageId: child }, cookie)).status, 403);
}));

test("child databases expose and consume continuation cursors", async () => fixture(async ({ fetch, databaseQueries }) => {
  const first = await (await fetch("/api/content/database", { slug: "fixture", databaseId: database, contentKind: "page" })).json();
  assert.equal(first.database.rows.length, 100);
  assert.equal(first.database.nextCursor, cursor);
  const second = await (await fetch("/api/content/database", { slug: "fixture", databaseId: database, contentKind: "page", cursor })).json();
  assert.equal(second.database.rows.length, 1);
  assert.equal(second.database.nextCursor, null);
  assert.equal(databaseQueries[1].start_cursor, cursor);
  const entry = await fetch("/api/content/page-child", { slug: "fixture", pageId: member });
  assert.equal(entry.status, 200, "database entries remain accessible on direct history restoration without a database in the trail");
  assert.match(JSON.stringify(await entry.json()), /MEMBER-FIXTURE-MARKER/);
  assert.equal((await fetch("/api/content/database", { slug: "fixture", databaseId: database, cursor: "/bad cursor" })).status, 400);
}, ""));

test("search and word cloud exclude a formerly public document still present in D1", async () => {
  const previousFetch = globalThis.fetch;
  let locked = false;
  const post = { id: root, title: "fixture", slug: "fixture", summary: "", category: "", tags: [], date: "", icon: "", locked: false };
  globalThis.fetch = async () => Response.json({ results: [{ id: root, properties: {
    title: { title: [{ plain_text: post.title }] }, slug: rich(post.slug), password: rich(locked ? "private" : ""),
    type: { select: { name: "Post" } }, status: { select: { name: "Published" } },
  } }], has_more: false });
  const db = { prepare(sql) { return {
    bind() { return this; }, async first() { return { request_count: 1, attempt_count: 1, window_start: Date.now() }; }, async run() { return { success: true }; },
    async all() { return { results: sql.includes("SELECT post_json") ? [{ post_json: JSON.stringify(post), body: "uniqueterm uniqueterm uniqueterm", search_body: "uniqueterm", partial: 0 }] : [] }; },
  }; } };
  try {
    const worker = (await import(`../dist/server/index.js?revocation=${Math.random()}`)).default;
    const env = { NOTION_TOKEN: "synthetic-test-token", NOTION_DATA_SOURCE_ID: "fixture-content", DB: db };
    const fetch = (path) => worker.fetch(new Request(`http://localhost${path}`), env, { waitUntil() {}, passThroughOnException() {} });
    assert.deepEqual((await (await fetch("/api/content/search?q=uniqueterm")).json()).matches, [root]);
    assert.equal((await (await fetch("/api/content/word-cloud")).json()).sourceCount, 1);
    locked = true;
    assert.deepEqual((await (await fetch("/api/content/search?q=uniqueterm")).json()).matches, []);
    const cloud = await (await fetch("/api/content/word-cloud")).json();
    assert.equal(cloud.sourceCount, 0);
    assert.deepEqual(cloud.words, []);
  } finally { globalThis.fetch = previousFetch; }
});

test("directory indexing retains progress when D1 checkpoints fail", async () => {
  const previousFetch = globalThis.fetch;
  const blockCursors = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/data_sources/fixture-content/query")) return Response.json({ results: [{ id: root, properties: { title: { title: [{ plain_text: "Long fixture" }] }, slug: rich("long"), password: rich("") } }], has_more: false });
    if (url.includes(`/blocks/${root}/children`)) {
      const n = Number(new URL(url).searchParams.get("start_cursor")?.slice(5) || 1);
      blockCursors.push(n);
      return Response.json({ results: [{ id: `heading-${n}`, type: "heading_1", heading_1: { rich_text: [{ plain_text: `Chapter ${n}` }] } }, ...Array.from({ length: 99 }, (_, i) => paragraph(`p-${n}-${i}`, "body"))], has_more: n < 5, next_cursor: n < 5 ? `page_${n + 1}` : null });
    }
    throw new Error("Unexpected directory fixture request");
  };
  const db = { prepare() { return { bind() { return this; }, async first() { throw new Error("D1 unavailable"); }, async run() { throw new Error("D1 unavailable"); } }; } };
  try {
    const worker = (await import(`../dist/server/index.js?headings=${Math.random()}`)).default;
    const env = { NOTION_TOKEN: "synthetic-test-token", NOTION_DATA_SOURCE_ID: "fixture-content", DB: db };
    const fetch = () => worker.fetch(new Request("http://localhost/api/content/post/long?headings=1"), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal((await fetch()).status, 202);
    const complete = await fetch();
    assert.equal(complete.status, 200);
    assert.equal((await complete.json()).headings.length, 5);
    assert.deepEqual(blockCursors, [1, 2, 3, 4, 5]);
  } finally { globalThis.fetch = previousFetch; }
});

test("media, child and database reads enforce shared limits before contacting Notion", async () => {
  const previousFetch = globalThis.fetch;
  let notionCalls = 0;
  globalThis.fetch = async () => { notionCalls++; throw new Error("rate-limited routes must not reach Notion"); };
  const db = { prepare() { return {
    bind() { return this; },
    async first() { return { request_count: 10_000, window_start: Date.now() }; },
  }; } };
  try {
    const worker = (await import(`../dist/server/index.js?limits=${Math.random()}`)).default;
    const env = { NOTION_TOKEN: "synthetic-test-token", DB: db };
    const context = { waitUntil() {}, passThroughOnException() {} };
    const requests = [
      new Request("http://localhost/api/content/child", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "fixture", pageId: child }) }),
      new Request("http://localhost/api/content/page-child", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "fixture", pageId: child }) }),
      new Request("http://localhost/api/content/database", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "fixture", databaseId: database }) }),
      new Request("http://localhost/_notion/media?id=invalid"),
    ];
    for (const request of requests) {
      const response = await worker.fetch(request, env, context);
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("retry-after") !== null, true);
    }
    assert.equal(notionCalls, 0);
  } finally { globalThis.fetch = previousFetch; }
});

test("search and word cloud reuse a short-lived metadata-only edge snapshot", async () => {
  const previousFetch = globalThis.fetch;
  const previousCaches = globalThis.caches;
  const entries = new Map();
  const pending = [];
  let postQueries = 0;
  const publicPost = { id: root, last_edited_time: "2026-10-13T00:00:00Z", properties: {
    title: { title: [{ plain_text: "Public fixture" }] }, slug: rich("fixture"), summary: rich(""), password: rich(""),
    type: { select: { name: "Post" } }, status: { select: { name: "Published" } },
  } };
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/data_sources/fixture-config/query")) return Response.json({ results: [], has_more: false });
    if (url.includes("/data_sources/fixture-content/query")) { postQueries++; return Response.json({ results: [publicPost], has_more: false }); }
    throw new Error(`Unexpected Notion request: ${url}`);
  };
  globalThis.caches = { default: {
    async match(key) { return entries.get(key.url)?.clone(); },
    async put(key, response) { entries.set(key.url, response.clone()); },
  } };
  const db = { prepare(sql) { return {
    bind() { return this; },
    async first() { return { request_count: 1, attempt_count: 1, window_start: Date.now() }; },
    async all() { return { results: sql.includes("SELECT post_json") ? [{ post_json: JSON.stringify({ id: root, title: "Public fixture", slug: "fixture", summary: "", category: "", tags: [], date: "", icon: "", locked: false }), body: "uniqueterm uniqueterm uniqueterm", search_body: "uniqueterm", partial: 0 }] : [] }; },
  }; } };
  try {
    const worker = (await import(`../dist/server/index.js?metadata-cache=${Math.random()}`)).default;
    const env = { NOTION_TOKEN: "synthetic-test-token", NOTION_DATA_SOURCE_ID: "fixture-content", NOTION_CONFIG_DATA_SOURCE_ID: "fixture-config", DB: db };
    const context = { waitUntil(promise) { pending.push(promise); }, passThroughOnException() {} };
    const fetch = (path) => worker.fetch(new Request(`http://localhost${path}`), env, context);
    const result = await (await fetch("/api/content/search?q=uniqueterm")).json();
    assert.deepEqual(result.matches, [root]);
    await Promise.all(pending.splice(0));
    const second = await fetch("/api/content/search?q=anotherterm");
    assert.deepEqual((await second.json()).matches, []);
    assert.equal(second.headers.get("cache-control"), "no-store", "search results remain private to the current request");
    assert.equal(postQueries, 1, "a second query should reuse the cross-isolate public ID snapshot");
    assert.equal(entries.size, 1);
    const stored = await entries.values().next().value.clone().text();
    assert.match(stored, new RegExp(root));
    assert.match(stored, /2026-10-13T00:00:00Z/);
    assert.doesNotMatch(stored, /uniqueterm|password|body/);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.caches = previousCaches;
  }
});

test("a cached public Page becomes inaccessible as soon as its current metadata requires a password", async () => fixture(async ({ fetch, page }) => {
  const previousCaches = globalThis.caches;
  const entries = new Map();
  let writes = 0;
  globalThis.caches = { default: {
    async match(key) { return entries.get(key.url)?.clone(); },
    async put(key, response) { writes++; entries.set(key.url, response.clone()); },
  } };
  try {
    const publicResponse = await fetch("/api/content/page/fixture");
    assert.equal(publicResponse.headers.get("cache-control"), "no-store");
    assert.match(JSON.stringify(await publicResponse.json()), /PRIVATE-FIXTURE-MARKER/);
    const writesBeforeProtection = writes;
    assert.ok(writesBeforeProtection > 0);
    page.properties.password = rich("new-private-password");
    const protectedResponse = await fetch("/api/content/page/fixture");
    const payload = await protectedResponse.json();
    assert.equal(payload.locked, true);
    assert.doesNotMatch(JSON.stringify(payload), /PRIVATE-FIXTURE-MARKER/);
    assert.equal(writes, writesBeforeProtection);
  } finally { globalThis.caches = previousCaches; }
}, ""));
