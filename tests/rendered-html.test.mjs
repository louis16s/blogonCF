import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createSharedRequest, readDisclosureState, writeDisclosureState } from "../app/components/clientState.js";
import { completeIntro, INTRO_BOOTSTRAP_SCRIPT, INTRO_DURATION_MS, THEME_BOOTSTRAP_SCRIPT } from "../app/components/introState.js";
import { buildWordCloud, normalizeSearchText } from "../shared/wordCloud.js";
import { withoutHiddenNotionBlocks } from "../shared/contentVisibility.js";

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
  assert.match(html, /prefers-reduced-motion/);
  assert.ok(html.indexOf("prefers-reduced-motion") < html.indexOf("site-intro"), "pre-paint decision must run before the intro markup");
  assert.doesNotMatch(html, /2026槟城/);
  assert.match(html, /http:\/\/localhost\/og\.jpg/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("news-page hide markers remove their whole display region while keeping source blocks immutable", () => {
  const blocks = [
    { id: "before", richText: [{ text: "公开介绍" }] },
    { id: "open", richText: [{ text: "———[hide]———" }], children: [{ id: "nested-feed", type: "bookmark", url: "https://feeds.example/feed.xml" }] },
    { id: "feed", type: "bookmark", url: "https://feeds.example/feed.xml" },
    { id: "close", richText: [{ text: "------[HIDE]------" }] },
    { id: "after", richText: [{ text: "公开结尾" }] },
  ];
  assert.deepEqual(withoutHiddenNotionBlocks(blocks).map((block) => block.id), ["before", "after"]);
  assert.equal(blocks.length, 5, "RSS discovery must still receive the original blocks");
  assert.equal(blocks[1].children[0].id, "nested-feed", "hidden nested RSS sources must remain available to the worker");
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
      { id: "penang", icon: { type: "emoji", emoji: "🌴" }, properties: { title: { title: [{ plain_text: "2026槟城" }] }, slug: { rich_text: [{ plain_text: "Penang" }] }, summary: { rich_text: [] }, category: { select: { name: "旅行游记" } }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [] } } },
      { id: "locked", properties: { title: { title: [{ plain_text: "Y-1" }] }, slug: { rich_text: [{ plain_text: "Y-1" }] }, summary: { rich_text: [{ plain_text: "hidden" }] }, category: { select: { name: "输入密码" } }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [{ plain_text: "hidden" }] } } },
      { id: "77777777-7777-4777-8777-777777777777", properties: { title: { title: [{ plain_text: "nikon F3p" }] }, slug: { rich_text: [] }, summary: { rich_text: [] }, category: { select: { name: "相机分享" } }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [] } } },
    ] });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id", NOTION_CONFIG_DATA_SOURCE_ID: "config-source" }, context);
    const html = await response.text();
    assert.match(html, /2026槟城/);
    assert.match(html, /🌴/, "Notion page emoji should be present in the rendered article card");
    assert.match(html, /Y-1/);
    assert.doesNotMatch(html, />hidden</, "locked article metadata must not reveal a password-like summary");
    assert.match(html, /nikon F3p/);
    assert.match(html, /测试工具/);
    assert.match(html, /测试作者/);
    assert.match(html, /2021/);
  } finally { globalThis.fetch = originalFetch; }
});

test("public site bootstrap deduplicates upstream Notion reads within its freshness window", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async (input, init = {}) => {
    upstreamCalls += 1;
    const url = String(input);
    const body = String(init.body || "");
    if (url.includes("/data_sources/config-source/query")) return Response.json({ results: [] });
    if (body.includes('"Menu"')) return Response.json({ results: [] });
    return Response.json({ results: [{ id: "cached-post", properties: {
      title: { title: [{ plain_text: "缓存文章" }] }, slug: { rich_text: [{ plain_text: "cached" }] }, summary: { rich_text: [] },
      category: { select: { name: "开发" } }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [] },
    } }] });
  };
  try {
    const env = { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "cache-source", NOTION_CONFIG_DATA_SOURCE_ID: "config-source" };
    const first = await worker.fetch(new Request("http://localhost/api/content/posts"), env, context);
    const second = await worker.fetch(new Request("http://localhost/api/content/posts"), env, context);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).posts[0].slug, "cached");
    assert.equal(upstreamCalls, 3, "posts, navigation, and config should each be read only once");
  } finally { globalThis.fetch = originalFetch; }
});

test("social preview image is correctly sized and kept below the initial multi-megabyte asset", async () => {
  const image = await readFile(new URL("../public/og.jpg", import.meta.url));
  assert.ok(image.length < 250_000, `expected an optimized social image, received ${image.length} bytes`);
});

test("client refresh failures preserve the last verified homepage and article content", async () => {
  const [blog, article] = await Promise.all([
    readFile(new URL("../app/components/BlogExplorer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ArticleClient.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(blog, /setSyncState\("unavailable"\)/);
  assert.doesNotMatch(blog, /\.catch\(\(\) => \{ setPosts\(\[\]\)/);
  assert.match(article, /实时同步暂时不可用，正在显示最近内容/);
  assert.doesNotMatch(article, /setPost\(undefined\)|setBlocks\(\[\]\)|setLocked\(false\)/);
});

test("HEIC decoding survives signed URL refreshes without repeated work", async () => {
  const article = await readFile(new URL("../app/components/ArticleClient.tsx", import.meta.url), "utf8");
  assert.match(article, /HEIC_DECODE_CONCURRENCY = 3/);
  assert.match(article, /sourceRef\.current = src/);
  assert.match(article, /return `\$\{block\.id\}:\$\{source\.hostname\}\$\{source\.pathname\}`/);
  assert.match(article, /\}, \[identity\]\)/);
  assert.match(article, /if \(skipInitialRefresh\.current\) \{[\s\S]*skipInitialRefresh\.current = false/);
});

test("overview renders every article immediately while retaining search and category filters", async () => {
  const [blog, footer] = await Promise.all([
    readFile(new URL("../app/components/BlogExplorer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ContentFooter.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(blog, /items\.slice\(/);
  assert.match(blog, /\{items\.map\(\(post, index\)/);
  assert.doesNotMatch(blog, /<p>\{post\.summary/);
  assert.match(blog, /\/api\/content\/search\?q=/);
  assert.match(blog, /contentMatches\.has\(post\.id\)/);
  assert.match(blog, /placeholder="搜索标题、正文…"/);
  assert.doesNotMatch(blog, /resource-strip|工具与订阅/);
  assert.match(blog, /siteLinks=\{siteLinks\}/);
  const [sidebar, navigationHook] = await Promise.all([
    readFile(new URL("../app/components/SiteSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/useSiteNavigation.ts", import.meta.url), "utf8"),
  ]);
  assert.match(sidebar, /小工具/);
  assert.match(sidebar, /link\.kind === "tool"/);
  assert.doesNotMatch(sidebar, /快速访问|blog-sidebar-quick-open|quick-links/);
  assert.match(navigationHook, /loadSiteBootstrap/);
  assert.doesNotMatch(sidebar, /categories\.slice/);
  assert.match(sidebar, /className="mobile-menu"/);
  assert.match(sidebar, />菜单</);
  assert.match(sidebar, /mobile-menu-disclosure mobile-category-list/);
  assert.doesNotMatch(sidebar, /mobile-category-list" open/);
  assert.doesNotMatch(sidebar, /文章归档|历史归档/);
  assert.match(sidebar, />RSS 订阅</);
  assert.match(sidebar, />文章分类/);
  assert.match(sidebar, /className="sidebar-section sidebar-categories"/);
  assert.doesNotMatch(sidebar, /sidebar-browse-title|sidebar-browse-panel|>浏览</);
  assert.match(sidebar, /key: "blog\.sidebar\.categories\.v2", defaultOpen: false/);
  assert.match(sidebar, /categories\.map\(\(item\)/);
  assert.match(blog, /categories=\{categories\}/);
  assert.match(blog, /onCategoryChange=\{selectCategory\}/);
  assert.doesNotMatch(blog, /className="filter-row"|className="filters"/);
  assert.match(sidebar, /className="mobile-menu-group mobile-menu-disclosure"/);
  assert.match(sidebar, /aboutLink && \(\s*<a href=\{aboutLink\.href\}/);
  assert.match(sidebar, /<a href=\{aboutLink\.href\}.*aboutLink\.title/s);
  assert.doesNotMatch(sidebar, /Notion<\/a> 创造，Cloudflare 带它兜风。/);
  assert.match(footer, /在 <a href="https:\/\/www\.notion\.so\/"/);
  assert.match(footer, /Notion<\/a> 创造，Cloudflare 带它兜风。/);
  assert.match(sidebar, /\$\{resolvedPostCount\} 篇公开文章/);
  assert.match(sidebar, /Notion 实时同步中/);
  assert.match(sidebar, /href="https:\/\/github\.com\/louis16s\/blogonCF"[\s\S]*>blogonCF/);
  assert.ok(sidebar.indexOf("newsLink.href") < sidebar.indexOf("rssLink.href"), "RSS should follow the news link");
  assert.ok(sidebar.indexOf('className="sidebar-cloud-link"') < sidebar.indexOf('className="sidebar-section sidebar-tools"'), "word cloud should precede tools");
  assert.match(sidebar, /aria-label="返回主页" title="返回主页"/);
  assert.doesNotMatch(sidebar, /HOME|<strong>返回主页/);
  assert.ok(sidebar.indexOf('>blogonCF</a>') < sidebar.lastIndexOf("rssLink &&"), "RSS should follow blogonCF in the sidebar footer");
  assert.doesNotMatch(sidebar, /©/);
  assert.doesNotMatch(blog, /className="sync-meta"/);
  assert.doesNotMatch(sidebar, /className="mobile-tools"/);
  assert.match(blog, /const visible = useMemo/);
  assert.match(blog, /category === ALL \|\| post\.category === category/);
  assert.match(blog, /post\.tags/);
  assert.doesNotMatch(blog, /SortMode|最新优先|最早优先|sort-select/);
  assert.doesNotMatch(blog, /同步 Notion 中的跳转菜单/);
  assert.doesNotMatch(blog, /首页全部展开/);
  assert.match(footer, /这里收录着 \$\{postCount\} 个文章。不赶时间，慢慢翻。/);
  assert.match(footer, /config\.footerQuotes/);
  assert.match(footer, /Math\.random\(\) \* quotes\.length/);
  assert.match(footer, /© \{config\.author\} \{years\}/);
  assert.doesNotMatch(footer, /© \{config\.author\} · \{years\}/);
  assert.match(blog, /<ContentFooter id="about" siteConfig=\{siteConfig\} postCount=\{posts\.length\}/);
  assert.doesNotMatch(blog, /最近常出现|buildWordCloud\(posts\)/);
  assert.match(blog, /<WordCloudDialog open=\{wordCloudOpen\}/);
  assert.match(sidebar, /href="\/#word-cloud"[\s\S]*>词云<\/Link>/);
  assert.match(blog, /post\.icon \|\| "📝"/, "article cards should render the Notion page emoji");
  assert.doesNotMatch(blog, /categoryIcons|post-icon|Heart|MapTrifold/, "category guesses must not replace Notion icons");
  assert.doesNotMatch(sidebar, />站点地图</, "the XML sitemap should not be presented as visitor navigation");
});

test("daylight theme uses a clear reference-led palette and word cloud offers six layouts", async () => {
  const [css, cloud] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/WordCloudDialog.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(css, /--bg: #fafaf9/);
  assert.match(css, /--surface: #ffffff/);
  assert.match(css, /--accent: #b96745/);
  assert.match(css, /\.post-emoji \{/);
  for (const mode of ["pile", "drift", "rows", "cascade", "constellation", "rank"]) {
    assert.match(cloud, new RegExp(`id: "${mode}"`));
  }
  assert.match(css, /\.word-cloud-canvas\.mode-cascade/);
  assert.match(css, /\.word-cloud-canvas\.mode-constellation/);
  assert.match(css, /\.word-cloud-canvas\.mode-rank/);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /@media \(max-height: 680px\)/);
  assert.match(css, /@media \(max-width: 900px\) and \(max-height: 520px\)/);
  assert.match(css, /overscroll-behavior-inline: contain/);
  assert.match(cloud, /createPortal/);
  assert.match(cloud, /document\.body/);
});

test("word cloud ranks only article titles and bodies deterministically", () => {
  const cloud = buildWordCloud([
    { id: "one", title: "旅行与相机", body: "用相机看旅行", summary: "摘要禁词 摘要禁词", category: "分类禁词", tags: ["标签禁词"] },
    { id: "two", title: "胶片相机散步", body: "旅行时带着胶片相机", summary: "摘要禁词", category: "分类禁词", tags: ["标签禁词"] },
    { id: "three", title: "旅行照片", body: "旅行中的照片", summary: "摘要禁词", category: "分类禁词", tags: ["标签禁词"] },
  ], 8);
  assert.equal(cloud[0].word, "旅行");
  assert.ok(cloud.every((item) => item.count >= 2 && item.level >= 1 && item.level <= 5));
  assert.ok(cloud.some((item) => item.word === "相机"));
  assert.ok(!cloud.some((item) => ["摘要禁词", "分类禁词", "标签禁词"].includes(item.word)));
  assert.ok(cloud.every((item) => item.tone >= 0 && item.tone <= 5 && item.tilt >= -4 && item.tilt <= 4));
  assert.deepEqual(cloud, buildWordCloud([
    { id: "one", title: "旅行与相机", body: "用相机看旅行" },
    { id: "two", title: "胶片相机散步", body: "旅行时带着胶片相机" },
    { id: "three", title: "旅行照片", body: "旅行中的照片" },
  ], 8));
});

test("every generated word uses the same Unicode normalization as article search", () => {
  const posts = [
    { id: "one", title: "ＡＩ ＡＩ 与 Cafe\u0301", body: "兼容字符 兼容字符", summary: "属性禁词", category: "属性禁词", tags: ["属性禁词"] },
  ];
  const cloud = buildWordCloud(posts);
  const corpus = normalizeSearchText(posts.flatMap((post) => [post.title, post.body]).join(" "));
  assert.ok(cloud.some((item) => item.word === "ai"));
  assert.ok(cloud.every((item) => corpus.includes(normalizeSearchText(item.word))), "clickable cloud words must match their normalized source corpus");
  assert.equal(normalizeSearchText("  ＡＩ  "), "ai");
});

test("rangefinder intro matches the 07cd9ba sequence, lasts at least five seconds, and remains motion-safe", async () => {
  const [layout, home, intro, css, asset, favicon] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/IntroSequence.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/rangefinder-intro.webp", import.meta.url)),
    readFile(new URL("../public/favicon.svg", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(layout, /IntroSequence|INTRO_BOOTSTRAP_SCRIPT/);
  assert.match(layout, /THEME_BOOTSTRAP_SCRIPT/);
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(home, /<IntroSequence \/>/);
  assert.match(home, /INTRO_BOOTSTRAP_SCRIPT/);
  assert.match(intro, /INTRO_DURATION_MS/);
  assert.match(intro, /useLayoutEffect/, "in-app navigation must start the homepage intro before paint");
  assert.doesNotMatch(intro, /\buseEffect\b/, "a passive effect can flash homepage content before the intro");
  assert.match(intro, /completeIntro\(document\.documentElement/);
  assert.ok(INTRO_DURATION_MS >= 5_000);
  assert.match(intro, />跳过<\/button>/);
  assert.match(intro, /rangefinder-intro\.webp/);
  assert.match(intro, />LOUIS16S</);
  assert.doesNotMatch(intro, /FRAME 01/);
  assert.match(intro, /正在对焦生活/);
  assert.match(intro, /intro-progress/);
  assert.doesNotMatch(intro, /intro-camera-rig|intro-lens-aperture|intro-aperture-blade|intro-shutter/);
  assert.match(css, /@keyframes intro-camera-journey/);
  assert.match(css, /@keyframes intro-caption-journey/);
  assert.match(css, /@keyframes intro-progress/);
  assert.match(css, /html\[data-intro="playing"\] \.site-intro \{ display: grid; \}/);
  assert.match(css, /\.site-intro \{ display: none !important; \}/);
  assert.ok(asset.length > 100_000, "intro asset should be a real optimized camera render");
  assert.match(favicon, /class="blade"/);
  assert.match(favicon, /prefers-color-scheme: dark/);
});

test("mobile header uses explicit labels, predictable links, and touch-sized controls", async () => {
  const [sidebar, blog, css] = await Promise.all([
    readFile(new URL("../app/components/SiteSidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/BlogExplorer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(sidebar, /<span>菜单<\/span>/);
  assert.doesNotMatch(sidebar, /文章归档|历史归档|快速访问/);
  assert.match(sidebar, />RSS 订阅<\/Link>/);
  assert.match(sidebar, /<summary><span>小工具<\/span><small>\{toolLinks\.length\}<\/small><CaretDown/);
  assert.match(sidebar, /小工具 <small>\{toolLinks\.length\}<\/small>/);
  assert.match(sidebar, /<small>外部<\/small>/);
  assert.match(sidebar, /aboutLink && \(\s*<a href=\{aboutLink\.href\}/, "unconfigured About links must not be invented on mobile");
  assert.doesNotMatch(sidebar, /href="\/#about"/);
  assert.match(sidebar, /event\.target instanceof Element && event\.target\.closest\("a, button"\)/, "mobile menu should close after a destination or category is chosen");
  assert.doesNotMatch(sidebar, /className="mobile-tools"/);
  assert.match(blog, /className="theme-label"/);
  assert.match(blog, /className="welcome-tagline"/);
  assert.match(css, /\.welcome \{ min-height: 42px;/);
  assert.match(css, /\.search-box \{ width: 270px; height: 42px;/);
  assert.match(css, /\.icon-button \{ width: 42px; height: 42px;/);
  assert.match(css, /\.sidebar-sync-meta \{[^}]*padding-top: 12px;[^}]*border-top: 1px solid var\(--line\);/);
  assert.match(css, /\.sidebar-main \{[^}]*overflow: visible;/);
  assert.match(css, /\.site-sidebar \{ position: sticky; top: 14px; z-index: 200;/);
  assert.match(css, /\.blog-main, \.article-shell \{ position: relative; z-index: 1;/);
  assert.match(css, /\.mobile-menu>summary \{ min-height: 44px;/);
  assert.match(css, /\.mobile-menu-list a \{ min-height: 38px;/);
  assert.match(css, /\.mobile-menu:not\(\[open\]\) \.mobile-menu-list \{ display: none; \}/);
  assert.match(css, /\.mobile-category-list button \{ min-height: 38px;/);
  assert.match(css, /\.footer-signature \{ align-self: flex-end; margin-left: auto; \}/);
});

test("intro bootstrap plays on reload and respects reduced motion", () => {
  const runBootstrap = (reducedMotion = false) => {
    const document = { documentElement: { dataset: {} } };
    const window = {
      matchMedia: () => ({ matches: reducedMotion }),
    };
    vm.runInNewContext(INTRO_BOOTSTRAP_SCRIPT, { document, window });
    return { document, window };
  };

  const firstVisit = runBootstrap();
  assert.equal(firstVisit.document.documentElement.dataset.intro, "playing");

  const bodyClasses = new Set(["intro-playing"]);
  completeIntro(firstVisit.document.documentElement, {
    classList: { remove: (name) => bodyClasses.delete(name) },
  });
  assert.equal(firstVisit.document.documentElement.dataset.intro, "complete");
  assert.equal(bodyClasses.has("intro-playing"), false);

  const reload = runBootstrap();
  assert.equal(reload.document.documentElement.dataset.intro, "playing", "a full reload plays the opening again");

  const reduced = runBootstrap(true);
  assert.equal(reduced.document.documentElement.dataset.intro, "complete", "reduced motion is hidden on the first frame");
});

test("theme bootstrap remains global when the intro is homepage-only", () => {
  const document = { documentElement: { dataset: {} } };
  const window = {
    localStorage: { getItem: () => "dark" },
    matchMedia: () => ({ matches: false }),
  };
  vm.runInNewContext(THEME_BOOTSTRAP_SCRIPT, { document, window });
  assert.equal(document.documentElement.dataset.theme, "dark");
  assert.equal(document.documentElement.dataset.intro, undefined);
});

test("shared client requests deduplicate concurrency and retry after failure", async () => {
  let calls = 0;
  const shared = createSharedRequest(async () => {
    calls++;
    if (calls === 1) throw new Error("temporary");
    return "ready";
  });
  const firstPair = await Promise.allSettled([shared(), shared()]);
  assert.equal(calls, 1);
  assert.deepEqual(firstPair.map(({ status }) => status), ["rejected", "rejected"]);
  assert.equal(await shared(), "ready");
  assert.equal(calls, 2, "a rejected request must not poison future refreshes");
  assert.equal(await shared(), "ready");
  assert.equal(calls, 2, "a successful request remains shared");
});

test("disclosure persistence uses the current key and survives storage errors", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(readDisclosureState(storage, "current", false), false);
  values.set("current", "true");
  assert.equal(readDisclosureState(storage, "current", false), true);
  writeDisclosureState(storage, "current", false);
  assert.equal(values.get("current"), "false");

  const blockedStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(readDisclosureState(blockedStorage, "current", true), true);
  assert.doesNotThrow(() => writeDisclosureState(blockedStorage, "current", false));
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
    assert.doesNotMatch(html, /site-intro|网站开场动画|rangefinder-intro/, "article routes must not render the homepage intro");
  } finally { globalThis.fetch = originalFetch; }
});

test("article header stays compact and the password form supports keyboard submission", async () => {
  const [article, articlePage, sitePage, css] = await Promise.all([
    readFile(new URL("../app/components/ArticleClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/blog/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/SiteContentPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(article, /className="article-title-row"/);
  assert.match(article, /className="article-summary"/);
  assert.match(article, /<form className="password-card" onSubmit=\{submit\}>/);
  assert.match(article, /enterKeyHint="go"/);
  assert.match(article, /type="submit"/);
  assert.match(article, /按 Enter 也可以直接解锁/);
  assert.match(article, /autoFocus/);
  assert.match(css, /\.article-title-row \{ display: grid;/);
  assert.match(css, /\.article-shell article \{[^}]*padding: 8px 0 70px;/);
  assert.match(articlePage, /<SiteSidebar showHomeLink \/>/);
  assert.match(sitePage, /<SiteSidebar showHomeLink \/>/);
  assert.doesNotMatch(articlePage, /返回全部文章|article-return/);
  assert.doesNotMatch(sitePage, /返回全部文章|article-return/);
  assert.match(css, /\.sidebar-home-link \{/);
  assert.match(article, /className="bookmark-preview"/);
  assert.match(article, /className="bookmark-copy"/);
  assert.match(article, /\/api\/content\/link-preview\?url=/);
  assert.doesNotMatch(article, /bookmarkSource\(block\.url\)\} · \{block\.url\}/);
  assert.match(css, /\.password-card-fields \{ display: grid;/);
  assert.match(css, /\.password-card \.password-submit/);
});

test("about and other Published Notion pages render inside the site shell", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const pageId = "118ad771-48f4-8006-8e05-f46d51bd244c";
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes(`/blocks/${pageId}/children`)) return Response.json({ results: [
      { id: "about-paragraph", type: "paragraph", has_children: false, paragraph: { rich_text: [{ plain_text: "这是本站渲染的关于我正文。", annotations: { bold: true } }] } },
      { id: "about-bookmark", type: "bookmark", has_children: false, bookmark: { url: "https://www.ifanr.com/", caption: [] } },
    ], has_more: false });
    if (url.includes("/data_sources/source-id/query")) {
      const body = JSON.parse(init.body);
      assert.ok(body.filter.and.some((item) => item.property === "type" && item.select?.equals === "Page"));
      return Response.json({ results: [{ id: pageId, properties: {
        type: { select: { name: "Page" } }, status: { select: { name: "Published" } },
        title: { title: [{ plain_text: "关于我_" }] }, slug: { rich_text: [{ plain_text: "me" }] }, summary: { rich_text: [{ plain_text: "关于 louis16s" }] }, icon: { rich_text: [{ plain_text: "fas fa-info" }] },
      } }], has_more: false });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const env = { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" };
    const response = await worker.fetch(new Request("http://localhost/about", { headers: { accept: "text/html" } }), env, context);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<title>关于我 · louis16s&#x27; blog<\/title>/);
    assert.match(html, /LOUIS16S · PAGE/);
    assert.match(html, /关于 louis16s/);
    assert.match(html, /这是本站渲染的关于我正文。/);
    assert.match(html, /爱范儿/);
    assert.match(html, /ifanr\.com/);
    assert.match(html, /class="sidebar-home-link"/);
    assert.match(html, /返回主页/);
    assert.doesNotMatch(html, />返回主页</);
    assert.doesNotMatch(html, /返回全部文章/);
    assert.doesNotMatch(html, /href="https:\/\/www\.notion\.so\/118ad771/);
    assert.doesNotMatch(html, /fas fa-info/);
    assert.doesNotMatch(html, /site-intro|网站开场动画|rangefinder-intro/, "about and page routes must not render the homepage intro");

    const api = await worker.fetch(new Request("http://localhost/api/content/page/about"), env, context);
    assert.equal(api.status, 200);
    assert.equal(api.headers.get("cache-control"), "no-store");
    const payload = await api.json();
    assert.equal(payload.post.title, "关于我");
    assert.equal(payload.post.slug, "me");
    assert.equal(payload.post.icon, "");
    assert.equal(payload.blocks[0].richText[0].text, "这是本站渲染的关于我正文。");
    assert.equal(payload.blocks[1].caption, "爱范儿");
  } finally { globalThis.fetch = originalFetch; }
});

test("about navigation uses a document link to avoid Safari soft-router URL errors", async () => {
  const sidebar = await readFile(new URL("../app/components/SiteSidebar.tsx", import.meta.url), "utf8");
  assert.match(sidebar, /<a href=\{aboutLink\.href\} target=\{aboutLink\.external \? "_blank" : undefined\}/);
  assert.doesNotMatch(sidebar, /<Link href=\{aboutLink\.href\}/);
});

test("site page routing keeps all Published Page content internal while tools remain external", async () => {
  const [workerSource, pageScreen, articleRoute, aboutRoute, genericRoute] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/SiteContentPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/blog/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/about/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page/[slug]/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(workerSource, /menuType === "Page"[\s\S]*\? isAbout \? "\/about" : pageSlug \? `\/page\//);
  assert.match(workerSource, /menuType === "Menu" && linkedNotionPageId \? `\/page\//);
  assert.match(workerSource, /menuType === "Menu" \|\| menuType === "Page" \? "nav" as const : "tool"/);
  assert.match(pageScreen, /contentKind="page"/);
  assert.match(aboutRoute, /SiteContentPage slug="about"/);
  assert.match(genericRoute, /SiteContentPage slug=\{decoded\}/);
  assert.doesNotMatch(pageScreen, /Notion · Cloudflare/);
  assert.doesNotMatch(articleRoute, /Notion · Cloudflare/);
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

test("malformed route escapes do not crash the Worker", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ results: [] });
  try {
    const response = await worker.fetch(new Request("http://localhost/api/content/post/%"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.equal(response.status, 404);
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

test("word-cloud endpoint reads public titles and bodies without leaking properties or locked articles", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const blockReads = [];
  let throttled = false;
  const page = (id, titleText, password = "") => ({ id, properties: {
    title: { title: [{ plain_text: titleText }] },
    slug: { rich_text: [{ plain_text: id }] },
    summary: { rich_text: [{ plain_text: "摘要禁词 摘要禁词" }] },
    category: { select: { name: "分类禁词" } },
    tags: { multi_select: [{ name: "标签禁词" }] },
    date: { date: null },
    password: { rich_text: password ? [{ plain_text: password }] : [] },
  } });
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/data_sources/source-id/query")) return Response.json({ results: [
      page("public-one", "山海 山海"),
      page("public-two", "公开标题"),
      page("locked-one", "私密标题 私密标题", "secret"),
    ], has_more: false });
    if (url.includes("/blocks/")) {
      blockReads.push(url);
      if (url.includes("public-one") && !throttled) {
        throttled = true;
        return Response.json({ message: "rate limited" }, { status: 429, headers: { "retry-after": "0" } });
      }
      const text = url.includes("public-one") ? "cloudflare cloudflare" : "山海 cloudflare";
      return Response.json({ results: [
        { id: `${blockReads.length}-paragraph`, type: "paragraph", has_children: false, paragraph: { rich_text: [{ plain_text: text, annotations: {} }] } },
        { id: `${blockReads.length}-code`, type: "code", has_children: false, code: { language: "javascript", rich_text: [{ plain_text: "forbidden_code forbidden_code", annotations: {} }], caption: [{ plain_text: "forbidden_caption forbidden_caption" }] } },
      ], has_more: false });
    }
    throw new Error(`Unexpected Notion request: ${url} ${init.method || "GET"}`);
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/content/word-cloud"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, max-age=300");
    const payload = await response.json();
    assert.equal(payload.sourceCount, 2);
    assert.equal(payload.partial, false);
    assert.ok(payload.words.some((item) => item.word === "山海" && item.postIds.includes("public-one")));
    assert.ok(payload.words.some((item) => item.word === "cloudflare"));
    assert.doesNotMatch(JSON.stringify(payload), /摘要禁词|分类禁词|标签禁词|私密标题|locked-one|secret|forbidden_code|forbidden_caption/);
    assert.equal(blockReads.length, 3, "a rate-limited block request should be retried");
    assert.ok(blockReads.every((url) => !url.includes("locked-one")), "locked pages must be excluded before any body request");

    const bodySearch = await worker.fetch(new Request("http://localhost/api/content/search?q=cloudflare"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.equal(bodySearch.status, 200);
    assert.equal(bodySearch.headers.get("cache-control"), "no-store");
    assert.deepEqual((await bodySearch.json()).matches.sort(), ["public-one", "public-two"]);

    const codeSearch = await worker.fetch(new Request("http://localhost/api/content/search?q=forbidden_code"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.deepEqual((await codeSearch.json()).matches.sort(), ["public-one", "public-two"], "code is searchable even though it stays out of the word cloud");

    const propertySearch = await worker.fetch(new Request("http://localhost/api/content/search?q=标签禁词"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.deepEqual((await propertySearch.json()).matches.sort(), ["public-one", "public-two"]);

    const lockedSearch = await worker.fetch(new Request("http://localhost/api/content/search?q=私密标题"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.deepEqual((await lockedSearch.json()).matches, [], "locked article content and properties must stay out of the public index");
    assert.equal(blockReads.length, 3, "word cloud and search should share one cached corpus");
  } finally { globalThis.fetch = originalFetch; }
});

test("news pages turn Notion-configured public feed URLs into safe RSS and Atom entries", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/data_sources/source-id/query")) return Response.json({ results: [{ id: "news-page", properties: {
      title: { title: [{ plain_text: "资讯" }] }, slug: { rich_text: [{ plain_text: "links" }] }, summary: { rich_text: [] }, type: { select: { name: "Page" } }, status: { select: { name: "Published" } }, date: { date: null },
    } }], has_more: false });
    if (url.includes("/blocks/news-page/children")) return Response.json({ results: [
      { id: "feed-link", type: "bookmark", has_children: false, bookmark: { url: "https://feeds.example.test/feed.xml", caption: [] } },
      { id: "preview-link", type: "bookmark", has_children: false, bookmark: { url: "https://www.ifanr.com/story", caption: [] } },
      { id: "unsafe-link", type: "bookmark", has_children: false, bookmark: { url: "http://127.0.0.1/private.xml", caption: [] } },
    ], has_more: false });
    if (url === "https://feeds.example.test/feed.xml") return new Response(`<?xml version="1.0"?><rss><channel><title>示例订阅</title><item><title>第一篇动态</title><link>https://example.test/posts/1</link><pubDate>Sat, 25 Jul 2026 12:00:00 GMT</pubDate><description><![CDATA[<b>正文摘要</b>]]></description></item></channel></rss>`, { headers: { "content-type": "application/rss+xml" } });
    if (url === "https://www.ifanr.com/story") return new Response(`<!doctype html><html><head><title>普通标题</title><meta name="description" content="关注明日产品的数字潮牌"><meta property="og:title" content="爱范儿"></head></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    throw new Error(`Unexpected request: ${url} ${init.method || "GET"}`);
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/content/rss-feeds?slug=links"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.feeds.length, 1);
    assert.equal(payload.feeds[0].title, "示例订阅");
    assert.deepEqual(payload.feeds[0].items[0], {
      id: "https://feeds.example.test/feed.xml#https://example.test/posts/1",
      title: "第一篇动态",
      url: "https://example.test/posts/1",
      published: "Sat, 25 Jul 2026 12:00:00 GMT",
      summary: "正文摘要",
    });
    const unauthorizedPreview = await worker.fetch(new Request("http://localhost/api/content/link-preview?url=https%3A%2F%2Fwww.ifanr.com%2Fstory"), { ASSETS: assets, NOTION_TOKEN: "test-token" }, context);
    assert.equal(unauthorizedPreview.status, 403);
    const pageResponse = await worker.fetch(new Request("http://localhost/api/content/page/links"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    const pagePayload = await pageResponse.json();
    const previewBlock = pagePayload.blocks.find((block) => block.id === "preview-link");
    assert.match(previewBlock.previewSignature, /^[A-Za-z0-9_-]{43}$/);
    const previewResponse = await worker.fetch(new Request(`http://localhost/api/content/link-preview?url=${encodeURIComponent(previewBlock.url)}&signature=${previewBlock.previewSignature}`), { ASSETS: assets, NOTION_TOKEN: "test-token" }, context);
    assert.equal(previewResponse.status, 200);
    assert.deepEqual(await previewResponse.json(), { title: "爱范儿", subtitle: "关注明日产品的数字潮牌", source: "ifanr.com" });
    for (const unsafe of ["http://[::1]/private", "http://user:pass@example.com/private", "http://192.168.1.2/private"]) {
      const blocked = await worker.fetch(new Request(`http://localhost/api/content/link-preview?url=${encodeURIComponent(unsafe)}`), { ASSETS: assets }, context);
      assert.equal(blocked.status, 400, `${unsafe} must not reach the external fetcher`);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("search prewarms its public body index and waits with skeletons before an empty result", async () => {
  const [worker, blog, article, css] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/BlogExplorer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ArticleClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /url\.searchParams\.get\("warm"\) === "1"/);
  assert.match(blog, /\/api\/content\/search\?warm=1/);
  assert.match(blog, /onFocus=\{\(\) => \{ void warmSearchIndex\(\)/);
  assert.doesNotMatch(blog, /requestIdleCallback/, "body indexing should start from search intent, not every homepage visit");
  assert.match(blog, /!visible\.length && searching && <div className="search-skeleton"/);
  assert.match(blog, /!visible\.length && !searching && \(/);
  assert.match(css, /\.search-skeleton/);
  assert.match(worker, /\/api\/content\/rss-feeds/);
  assert.match(article, /\/api\/content\/rss-feeds\?slug=/);
  assert.match(article, /RSS READER/);
});

test("sitemap is generated from current Published posts and safely degrades", async () => {
  const worker = await loadWorker();
  const safe = await worker.fetch(new Request("http://localhost/sitemap.xml"), { ASSETS: assets }, context);
  const safeXml = await safe.text();
  assert.match(safeXml, /http:\/\/localhost\/<\/loc>/);
  assert.doesNotMatch(safeXml, /\/blog\//);
  const head = await worker.fetch(new Request("http://localhost/sitemap.xml", { method: "HEAD" }), { ASSETS: assets }, context);
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-type"), /application\/xml/);
  assert.equal(await head.text(), "");
  const canonical = await worker.fetch(new Request("http://localhost/sitemap.xml"), { ASSETS: assets, SITE_URL: "https://canonical.example" }, context);
  assert.match(await canonical.text(), /https:\/\/canonical\.example\/<\/loc>/);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init = {}) => {
    const body = JSON.parse(init.body || "{}");
    const pageQuery = body.filter?.and?.some((item) => item.property === "type" && item.select?.equals === "Page");
    return pageQuery
      ? Response.json({ results: [{ id: "rss-config-page", properties: { type: { select: { name: "Page" } }, title: { title: [{ plain_text: "RSS_" }] }, slug: { rich_text: [{ plain_text: "rss" }] }, summary: { rich_text: [] } } }], has_more: false })
      : Response.json({ results: [{ id: "sitemap-page", properties: {
        title: { title: [{ plain_text: "站点文章" }] }, slug: { rich_text: [{ plain_text: "a & b" }] }, summary: { rich_text: [] }, category: { select: null }, tags: { multi_select: [] }, date: { date: { start: "2026-03-04" } }, password: { rich_text: [] },
      } }], has_more: false });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/sitemap.xml"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    const xml = await response.text();
    assert.match(xml, /\/blog\/a%20%26%20b<\/loc>/);
    assert.match(xml, /<lastmod>2026-03-04<\/lastmod>/);
    assert.doesNotMatch(xml, /\/page\/rss<\/loc>/);
    assert.equal(response.headers.get("cache-control"), "public, max-age=300, stale-while-revalidate=86400");
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
    assert.equal(response.headers.get("cache-control"), "public, max-age=300, stale-while-revalidate=86400");
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
    assert.match(payload.blocks[0].url, /^\/_notion\/image\?id=.*&url=/);
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
    assert.equal(response.headers.get("cache-control"), "private, max-age=3600");
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

test("content endpoint maps only filtered metadata while keeping browser responses fresh", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (input, init) => {
    assert.equal(init.headers.authorization, "Bearer test-token");
    if (String(input).includes("fffad771-48f4-8181-b48e-000b8cf60e1b")) return Response.json({ results: [
      { id: "author", properties: { "启用": { checkbox: true }, "配置名": { title: [{ plain_text: "AUTHOR" }] }, "配置值": { rich_text: [{ plain_text: "Notion 作者" }] }, "其他私密项": { rich_text: [{ plain_text: "不得输出" }] } } },
      { id: "since", properties: { "启用": { checkbox: true }, "配置名": { title: [{ plain_text: "`SINCE`" }] }, "配置值": { rich_text: [{ plain_text: "始于 2019 年" }] } } },
      { id: "quotes", properties: { "启用": { checkbox: true }, "配置名": { title: [{ plain_text: "FOOTER_QUOTES" }] }, "配置值": { rich_text: [{ plain_text: "第一句｜第二句\n第三句 | 第四句" }] } } },
      { id: "disabled", properties: { "启用": { checkbox: false }, "配置名": { title: [{ plain_text: "AUTHOR" }] }, "配置值": { rich_text: [{ plain_text: "禁用作者" }] } } },
    ] });
    assert.match(String(input), /\/v1\/data_sources\/source-id\/query$/);
    const body = JSON.parse(init.body);
    if (body.filter.and.some((item) => item.or)) return Response.json({ results: [
      { id: "rss", properties: { title: { title: [{ plain_text: "RSS" }] }, slug: { rich_text: [{ plain_text: "rss/feed.xml" }] }, summary: { rich_text: [{ plain_text: "订阅" }] }, icon: { rich_text: [] } } },
      { id: "tool", icon: { type: "emoji", emoji: "👾" }, properties: { title: { title: [{ plain_text: "超焦距" }] }, slug: { rich_text: [{ plain_text: "https://hd.530555.xyz" }] }, summary: { rich_text: [{ plain_text: "跳转hd" }] }, icon: { rich_text: [] } } },
      { id: "annotated", properties: { title: { title: [{ plain_text: "带跳转的工具" }] }, slug: { rich_text: [{ plain_text: "links" }] }, summary: { rich_text: [{ plain_text: "Notion 注释链接", href: "https://annotated.example" }] }, icon: { rich_text: [] } } },
      { id: "archive", properties: { type: { select: { name: "Menu" } }, title: { title: [{ plain_text: "历史归档" }] }, slug: { rich_text: [{ plain_text: "/archive" }] }, summary: { rich_text: [] }, icon: { rich_text: [] } } },
      { id: "118ad771-48f4-8006-8e05-f46d51bd244c", properties: { type: { select: { name: "Page" } }, title: { title: [{ plain_text: "关于我_" }] }, slug: { rich_text: [{ plain_text: "me" }] }, summary: { rich_text: [] }, icon: { rich_text: [] } } },
      { id: "fffad771-48f4-816c-b993-d78a936a4c78", properties: { type: { select: { name: "Page" } }, title: { title: [{ plain_text: "资讯_" }] }, slug: { rich_text: [{ plain_text: "links" }] }, summary: { rich_text: [] }, icon: { rich_text: [] } } },
      { id: "broken", properties: { title: { title: [{ plain_text: "资讯" }] }, slug: { rich_text: [{ plain_text: "links" }] }, summary: { rich_text: [] }, icon: { rich_text: [] } } },
    ] });
    requestBody = body;
    return Response.json({ results: [{ id: "page-1", created_time: "2026-01-01T00:00:00Z", icon: { type: "emoji", emoji: "✦" }, properties: {
      title: { title: [{ plain_text: "公开文章" }] }, slug: { rich_text: [{ plain_text: "public-post" }] }, summary: { rich_text: [{ plain_text: "摘要" }] },
      category: { select: { name: "旅行游记" } }, tags: { multi_select: [{ name: "旅行" }] }, date: { date: { start: "2026-01-02" } }, password: { rich_text: [] },
    } }] });
  };
  try {
    const env = { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" };
    const response = await worker.fetch(new Request("http://localhost/api/content/posts"), env, context);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache, max-age=0, must-revalidate");
    const payload = await response.json();
    assert.equal(payload.posts[0].slug, "public-post");
    assert.deepEqual(payload.posts[0].tags, ["旅行"]);
    assert.deepEqual(payload.links.map((link) => [link.title, link.href, link.kind]), [["RSS", "/rss.xml", "rss"], ["超焦距", "https://hd.530555.xyz", "tool"], ["带跳转的工具", "https://annotated.example", "tool"], ["关于我", "/about", "nav"], ["资讯", "/page/links", "nav"]]);
    assert.equal(payload.config.author, "Notion 作者");
    assert.equal(payload.config.since, "2019");
    assert.deepEqual(payload.config.footerQuotes, [{ lead: "第一句", sub: "第二句" }, { lead: "第三句", sub: "第四句" }]);
    assert.doesNotMatch(JSON.stringify(payload), /不得输出|禁用作者/);
    assert.deepEqual(requestBody.filter.and.map((item) => item.property), ["type", "status"]);
    const head = await worker.fetch(new Request("http://localhost/api/content/posts", { method: "HEAD" }), env, context);
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  } finally { globalThis.fetch = originalFetch; }
});

test("navigation endpoint returns only live Notion-configured jump links", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ results: [
    { id: "tool", icon: { type: "emoji", emoji: "🧭" }, properties: { title: { title: [{ plain_text: "导航工具" }] }, slug: { rich_text: [{ plain_text: "打开", href: "https://nav.example" }] }, summary: { rich_text: [] } } },
    { id: "uppercase-url", properties: { type: { select: { name: "SubMenu" } }, title: { title: [{ plain_text: "URL 属性工具" }] }, slug: { rich_text: [{ plain_text: "tool" }] }, URL: { url: "https://uppercase.example/tool" }, summary: { rich_text: [] } } },
    { id: "118ad771-48f4-8006-8e05-f46d51bd244c", properties: { type: { select: { name: "Page" } }, title: { title: [{ plain_text: "关于我_" }] }, slug: { rich_text: [{ plain_text: "me" }] }, summary: { rich_text: [] } } },
    { id: "fffad771-48f4-816c-b993-d78a936a4c78", properties: { type: { select: { name: "Page" } }, title: { title: [{ plain_text: "资讯_" }] }, slug: { rich_text: [{ plain_text: "links" }] }, summary: { rich_text: [] } } },
    { id: "fffad771-48f4-810c-987c-000c02fa3dea", properties: { type: { select: { name: "Page" } }, title: { title: [{ plain_text: "RSS_" }] }, slug: { rich_text: [{ plain_text: "rss-page" }] }, summary: { rich_text: [] } } },
    { id: "invalid", properties: { title: { title: [{ plain_text: "无效跳转" }] }, slug: { rich_text: [{ plain_text: "javascript:alert(1)" }] }, summary: { rich_text: [] } } },
  ] });
  try {
    const response = await worker.fetch(new Request("http://localhost/api/content/navigation"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache, max-age=0, must-revalidate");
    assert.deepEqual(await response.json(), { links: [
      { id: "tool", title: "导航工具", href: "https://nav.example", summary: "", icon: "🧭", external: true, kind: "tool" },
      { id: "uppercase-url", title: "URL 属性工具", href: "https://uppercase.example/tool", summary: "", icon: "", external: true, kind: "tool" },
      { id: "118ad771-48f4-8006-8e05-f46d51bd244c", title: "关于我", href: "/about", summary: "", icon: "", external: false, kind: "nav" },
      { id: "fffad771-48f4-816c-b993-d78a936a4c78", title: "资讯", href: "/page/links", summary: "", icon: "", external: false, kind: "nav" },
      { id: "fffad771-48f4-810c-987c-000c02fa3dea", title: "RSS", href: "/rss.xml", summary: "", icon: "", external: false, kind: "rss" },
    ], source: "notion" });
  } finally { globalThis.fetch = originalFetch; }
});

test("navigation endpoint follows Notion pagination", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const cursors = [];
  globalThis.fetch = async (_input, init = {}) => {
    const body = JSON.parse(init.body || "{}");
    cursors.push(body.start_cursor);
    const page = (id, titleText, slug) => ({ id, properties: {
      type: { select: { name: "SubMenu" } },
      title: { title: [{ plain_text: titleText }] },
      slug: { rich_text: [{ plain_text: slug }] },
      summary: { rich_text: [] },
    } });
    return body.start_cursor
      ? Response.json({ results: [page("second", "第二个工具", "https://second.example")], has_more: false })
      : Response.json({ results: [page("first", "第一个工具", "https://first.example")], has_more: true, next_cursor: "page-2" });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/content/navigation"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).links.map((link) => link.id), ["first", "second"]);
    assert.deepEqual(cursors, [undefined, "page-2"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("legacy icon properties accept one emoji and reject icon classes or mixed text", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ results: [
    { id: "native", icon: { type: "emoji", emoji: "📷" }, properties: { title: { title: [{ plain_text: "原生图标" }] }, slug: { rich_text: [{ plain_text: "https://native.example" }] }, icon: { rich_text: [{ plain_text: "fas fa-camera" }] } } },
    { id: "legacy", properties: { title: { title: [{ plain_text: "旧字段 Emoji" }] }, slug: { rich_text: [{ plain_text: "https://legacy.example" }] }, icon: { rich_text: [{ plain_text: "👨‍💻" }] } } },
    { id: "class", properties: { title: { title: [{ plain_text: "图标类" }] }, slug: { rich_text: [{ plain_text: "https://class.example" }] }, icon: { rich_text: [{ plain_text: "fas fa-info" }] } } },
    { id: "mixed", properties: { title: { title: [{ plain_text: "混合文本" }] }, slug: { rich_text: [{ plain_text: "https://mixed.example" }] }, icon: { rich_text: [{ plain_text: "fas fa-info 😀" }] } } },
  ] });
  try {
    const response = await worker.fetch(new Request("http://localhost/api/content/navigation"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" }, context);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.links.map((link) => [link.id, link.icon]), [
      ["native", "📷"],
      ["legacy", "👨‍💻"],
      ["class", ""],
      ["mixed", ""],
    ]);
  } finally { globalThis.fetch = originalFetch; }
});

test("public config endpoint exposes only the public footer, author, and year allowlist", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /\/v1\/data_sources\/config-source\/query$/);
    return Response.json({ results: [
      { properties: { "启用": { checkbox: true }, "配置名": { title: [{ plain_text: "AUTHOR" }] }, "配置值": { rich_text: [{ plain_text: "louis16s" }] } } },
      { properties: { "启用": { checkbox: true }, "配置名": { title: [{ plain_text: "SINCE" }] }, "配置值": { rich_text: [{ plain_text: "2020" }] } } },
      { properties: { "启用": { checkbox: true }, "配置名": { title: [{ plain_text: "SECRET" }] }, "配置值": { rich_text: [{ plain_text: "never-leak" }] } } },
      { properties: { "配置名": { title: [{ plain_text: "AUTHOR" }] }, "配置值": { rich_text: [{ plain_text: "缺少启用字段" }] } } },
    ] });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/content/config"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_CONFIG_DATA_SOURCE_ID: "config-source" }, context);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache, max-age=0, must-revalidate");
    const payload = await response.json();
    assert.equal(payload.source, "notion");
    assert.equal(payload.config.author, "louis16s");
    assert.equal(payload.config.since, "2020");
    assert.ok(payload.config.footerQuotes.length >= 6);
    assert.doesNotMatch(JSON.stringify(payload), /never-leak|缺少启用字段/);
  } finally { globalThis.fetch = originalFetch; }
});

test("public config endpoint follows pagination before resolving AUTHOR and SINCE", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(init.body);
    if (calls === 1) {
      assert.equal(body.start_cursor, undefined);
      return Response.json({
        results: [{ properties: { "启用": { checkbox: true }, "配置名": { title: [{ plain_text: "AUTHOR" }] }, "配置值": { rich_text: [{ plain_text: "分页作者" }] } } }],
        has_more: true,
        next_cursor: "config-page-2",
      });
    }
    assert.equal(body.start_cursor, "config-page-2");
    return Response.json({
      results: [{ properties: { "启用": { checkbox: true }, "配置名": { title: [{ plain_text: "SINCE" }] }, "配置值": { rich_text: [{ plain_text: "始于 2018" }] } } }],
      has_more: false,
    });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/content/config"), { ASSETS: assets, NOTION_TOKEN: "test-token", NOTION_CONFIG_DATA_SOURCE_ID: "config-source" }, context);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.config.author, "分页作者");
    assert.equal(payload.config.since, "2018");
    assert.ok(payload.config.footerQuotes.length >= 6);
    assert.equal(calls, 2);
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
  const unpublishedReferenceId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const outsideId = "33333333-3333-4333-8333-333333333333";
  let childBlockRequests = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes(`/pages/${childId}`)) return Response.json({ id: childId, parent: { type: "page_id", page_id: parentId }, icon: { type: "emoji", emoji: "📖" }, properties: { title: { type: "title", title: [{ plain_text: "第一章" }] } } });
    if (url.includes(`/pages/${nestedId}`)) return Response.json({ id: nestedId, parent: { type: "page_id", page_id: intermediateId }, properties: { title: { type: "title", title: [{ plain_text: "嵌套章节" }] } } });
    if (url.includes(`/pages/${intermediateId}`)) return Response.json({ id: intermediateId, parent: { type: "page_id", page_id: parentId }, properties: { title: { type: "title", title: [{ plain_text: "中间章节" }] } } });
    if (url.includes(`/pages/${referencedId}`)) return Response.json({ id: referencedId, parent: { type: "workspace", workspace: true }, properties: { title: { type: "title", title: [{ plain_text: "同步块引用页" }] } } });
    if (url.includes(`/pages/${nestedReferenceId}`)) return Response.json({ id: nestedReferenceId, parent: { type: "page_id", page_id: referencedId }, properties: { title: { type: "title", title: [{ plain_text: "引用页的下一级" }] } } });
    if (url.includes(`/pages/${richReferenceId}`)) return Response.json({ id: richReferenceId, parent: { type: "workspace", workspace: true }, properties: { title: { type: "title", title: [{ plain_text: "富文本引用页" }] } } });
    if (url.includes(`/pages/${unpublishedReferenceId}`)) return Response.json({ id: unpublishedReferenceId, parent: { type: "workspace", workspace: true }, properties: { title: { type: "title", title: [{ plain_text: "未发布引用页" }] } } });
    if (url.includes(`/pages/${outsideId}`)) return Response.json({ id: outsideId, parent: { type: "page_id", page_id: "44444444-4444-4444-8444-444444444444" }, properties: { title: { type: "title", title: [{ plain_text: "不属于本文" }] } } });
    if (url.includes(`/pages/44444444-4444-4444-8444-444444444444`)) return Response.json({ id: "44444444-4444-4444-8444-444444444444", parent: { type: "workspace", workspace: true }, properties: {} });
    if (url.includes(`/blocks/${childId}/children`)) {
      childBlockRequests++;
      return Response.json({ results: [{ id: "child-paragraph", type: "paragraph", has_children: false, paragraph: { rich_text: [{ plain_text: "站内子页面正文", annotations: {} }] } }], has_more: false });
    }
    if (url.includes(`/blocks/${nestedId}/children`)) { childBlockRequests++; return Response.json({ results: [], has_more: false }); }
    if (url.includes(`/blocks/${parentId}/children`)) return Response.json({ results: [
      { id: referencedId, type: "child_page", has_children: true, child_page: { title: "同步块引用页" } },
      { id: unpublishedReferenceId, type: "child_page", has_children: true, child_page: { title: "未发布引用页" } },
      { id: "rich-link", type: "paragraph", has_children: false, paragraph: { rich_text: [{ plain_text: "富文本引用", href: `https://app.notion.com/p/${richReferenceId.replaceAll("-", "")}`, annotations: {} }] } },
    ], has_more: false });
    if (url.includes(`/blocks/${referencedId}/children`)) { childBlockRequests++; return Response.json({ results: [{ id: nestedReferenceId, type: "child_page", has_children: true, child_page: { title: "引用页的下一级" } }], has_more: false }); }
    if (url.includes(`/blocks/${nestedReferenceId}/children`)) { childBlockRequests++; return Response.json({ results: [], has_more: false }); }
    if (url.includes(`/blocks/${richReferenceId}/children`)) { childBlockRequests++; return Response.json({ results: [], has_more: false }); }
    if (url.includes("/data_sources/") && init.body) {
      const body = JSON.parse(init.body);
      const pageFilter = body.filter?.and?.some((item) => item.property === "type" && item.select?.equals === "Page");
      if (pageFilter) return Response.json({ results: [referencedId, richReferenceId].map((id) => ({
        id,
        properties: {
          title: { type: "title", title: [{ plain_text: id === referencedId ? "同步块引用页" : "富文本引用页" }] },
          type: { select: { name: "Page" } },
          password: { rich_text: [] },
        },
      })), has_more: false });
    }
    return Response.json({ results: [{ id: parentId, properties: {
      title: { title: [{ plain_text: "目录文章" }] }, slug: { rich_text: [{ plain_text: "index" }] }, summary: { rich_text: [] }, category: { select: { name: "输入密码" } }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [{ plain_text: "correct" }] },
    } }] });
  };
  const env = { ASSETS: assets, DB: createRateLimitDb(), NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" };
  try {
    const missing = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "index", pageId: childId }) }), env, context);
    assert.equal(missing.status, 403);
    assert.equal(childBlockRequests, 0, "a missing parent password must never fetch child content");

    const wrong = await worker.fetch(new Request("http://localhost/api/content/post/index", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "wrong" }) }), env, context);
    assert.equal(wrong.status, 401);
    assert.equal(childBlockRequests, 0, "a wrong parent password must never fetch child content");

    const unlock = await worker.fetch(new Request("http://localhost/api/content/post/index", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct" }) }), env, context);
    const cookie = unlock.headers.get("set-cookie").split(";", 1)[0];
    assert.match(unlock.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
    const childHeaders = { "content-type": "application/json", cookie };
    const correct = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: childHeaders, body: JSON.stringify({ slug: "index", pageId: childId }) }), env, context);
    assert.equal(correct.status, 200);
    assert.equal(correct.headers.get("cache-control"), "no-store");
    assert.deepEqual(await correct.json(), { child: { id: childId, title: "第一章", icon: "📖", blocks: [{ id: "child-paragraph", type: "paragraph", richText: [{ text: "站内子页面正文" }] }], hasMore: false, truncated: false } });
    assert.equal(childBlockRequests, 1);

    const nested = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: childHeaders, body: JSON.stringify({ slug: "index", pageId: nestedId }) }), env, context);
    assert.equal(nested.status, 200);
    assert.equal((await nested.json()).child.id, nestedId, "nested ancestry must return the requested page rather than its intermediate parent");
    assert.equal(childBlockRequests, 2);

    const referenced = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: childHeaders, body: JSON.stringify({ slug: "index", pageId: referencedId }) }), env, context);
    assert.equal(referenced.status, 200, "a page explicitly referenced by unlocked parent blocks must remain available on-site");
    assert.equal((await referenced.json()).child.title, "同步块引用页");

    const nestedReference = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: childHeaders, body: JSON.stringify({ slug: "index", pageId: nestedReferenceId, trail: [referencedId] }) }), env, context);
    assert.equal(nestedReference.status, 200, "a nested referenced page must be authorized through the verified trail");
    assert.equal((await nestedReference.json()).child.title, "引用页的下一级");

    const richReference = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: childHeaders, body: JSON.stringify({ slug: "index", pageId: richReferenceId }) }), env, context);
    assert.equal(richReference.status, 200, "a Notion page linked from rich text must remain available on-site");
    assert.equal((await richReference.json()).child.title, "富文本引用页");

    const unpublishedReference = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: childHeaders, body: JSON.stringify({ slug: "index", pageId: unpublishedReferenceId }) }), env, context);
    assert.equal(unpublishedReference.status, 404, "a referenced page outside the Published collection must stay private");

    const outside = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: childHeaders, body: JSON.stringify({ slug: "index", pageId: outsideId }) }), env, context);
    assert.equal(outside.status, 404);
    assert.equal(childBlockRequests, 5, "unpublished and unrelated pages must never expose their blocks");
  } finally { globalThis.fetch = originalFetch; }
});

test("large child pages stream through authenticated cursor chunks", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const parentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const childId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const blockRequests = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes(`/pages/${childId}`)) return Response.json({
      id: childId,
      parent: { type: "page_id", page_id: parentId },
      properties: { title: { type: "title", title: [{ plain_text: "长篇子页面" }] } },
    });
    if (url.includes(`/blocks/${childId}/children`)) {
      blockRequests.push(url);
      const second = url.includes("start_cursor=cursor_2");
      return Response.json({
        results: [{ id: second ? "chunk-2" : "chunk-1", type: "paragraph", has_children: false, paragraph: { rich_text: [{ plain_text: second ? "第二段" : "第一段", annotations: {} }] } }],
        has_more: !second,
        next_cursor: second ? null : "cursor_2",
      });
    }
    return Response.json({ results: [{ id: parentId, properties: {
      title: { title: [{ plain_text: "目录文章" }] }, slug: { rich_text: [{ plain_text: "long-index" }] }, summary: { rich_text: [] }, category: { select: null }, tags: { multi_select: [] }, date: { date: null }, password: { rich_text: [{ plain_text: "correct" }] },
    } }] });
  };
  const env = { ASSETS: assets, DB: createRateLimitDb(), NOTION_TOKEN: "test-token", NOTION_DATA_SOURCE_ID: "source-id" };
  try {
    const unlock = await worker.fetch(new Request("http://localhost/api/content/post/long-index", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct" }) }), env, context);
    const cookie = unlock.headers.get("set-cookie").split(";", 1)[0];
    const childHeaders = { "content-type": "application/json", cookie };
    const first = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: childHeaders, body: JSON.stringify({ slug: "long-index", pageId: childId }) }), env, context);
    assert.equal(first.status, 200);
    const firstPayload = await first.json();
    assert.deepEqual(firstPayload.child.blocks.map((block) => block.id), ["chunk-1"]);
    assert.equal(firstPayload.child.hasMore, true);
    assert.equal(firstPayload.child.nextCursor, "cursor_2");

    const second = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: childHeaders, body: JSON.stringify({ slug: "long-index", pageId: childId, cursor: firstPayload.child.nextCursor }) }), env, context);
    assert.equal(second.status, 200);
    const secondPayload = await second.json();
    assert.deepEqual(secondPayload.child.blocks.map((block) => block.id), ["chunk-2"]);
    assert.equal(secondPayload.child.hasMore, false);
    assert.equal(secondPayload.child.nextCursor, undefined);

    const invalid = await worker.fetch(new Request("http://localhost/api/content/child", { method: "POST", headers: childHeaders, body: JSON.stringify({ slug: "long-index", pageId: childId, cursor: "$invalid" }) }), env, context);
    assert.equal(invalid.status, 400);
    assert.equal(blockRequests.length, 2, "invalid cursors must be rejected before reading Notion blocks");
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
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(article, /contentKind === "page" \? "\/api\/content\/page-child" : "\/api\/content\/child"/);
  assert.match(article, /history\.pushState/);
  assert.match(article, /case "child_page": return block\.pageId/);
  assert.match(article, /const isChildView = childOpening \|\| Boolean\(activeChild\)/);
  assert.match(article, /\{!isChildView \? <header className="article-head">/);
  assert.match(article, /返回上一级/);
  assert.match(css, /\.child-document-head \{[^}]*border-bottom:/);
  assert.match(css, /\.child-document-body>\.notion-content \{ padding-top:/);
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
