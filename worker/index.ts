/** Cloudflare Worker entry point with a small Notion content gateway. */
/* eslint-disable @typescript-eslint/no-explicit-any -- Notion block/property unions are normalized at this gateway boundary. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { clearPasswordAttempts, getPasswordAttemptStatus, recordPasswordFailure } from "../db/rate-limit";
import { clearArticlePayload, storeArticlePayload, type ArticlePayload } from "../server/article-context";
import { clearHomePayload, storeHomePayload, type HomePayload } from "../server/home-context";
import { buildWordCloud } from "../shared/wordCloud.js";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  NOTION_TOKEN?: string;
  NOTION_DATA_SOURCE_ID?: string;
  NOTION_CONFIG_DATA_SOURCE_ID?: string;
  IMAGES?: {
    input(stream: ReadableStream): { transform(options: Record<string, unknown>): { output(options: { format: string; quality: number }): Promise<{ response(): Response }> } };
  };
}
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }

const DEFAULT_DATA_SOURCE_ID = "fffad771-48f4-81f5-be17-000b319f85ad";
const DEFAULT_CONFIG_DATA_SOURCE_ID = "fffad771-48f4-8181-b48e-000b8cf60e1b";
const NOTION_VERSION = "2026-03-11";
const NOTION_IMAGE_HOSTS = new Set(["prod-files-secure.s3.us-west-2.amazonaws.com"]);
const MAX_BLOCKS = 10_000;
const MAX_BLOCK_DEPTH = 12;
const MAX_WORD_CLOUD_BLOCKS_PER_POST = 800;
const WORD_CLOUD_CACHE_TTL_MS = 10 * 60 * 1000;
const LEGACY_EMOJI_PATTERN = /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)$/u;
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" };
const wordCloudCache = new Map<string, { expiresAt: number; payload: WordCloudPayload }>();

type WordCloudPayload = { words: ReturnType<typeof buildWordCloud>; sourceCount: number; partial: boolean; source: "notion" };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/sitemap.xml" && (request.method === "GET" || request.method === "HEAD")) return withHead(request, await notionSitemap(env));
    if (url.pathname === "/rss.xml" && (request.method === "GET" || request.method === "HEAD")) return withHead(request, await notionRss(env));
    if (url.pathname === "/api/content/posts" && request.method === "GET") return notionPosts(env);
    if (url.pathname === "/api/content/navigation" && request.method === "GET") return notionNavigation(env);
    if (url.pathname === "/api/content/config" && request.method === "GET") return notionSiteConfig(env);
    if (url.pathname === "/api/content/word-cloud" && request.method === "GET") return notionWordCloud(env);
    if (url.pathname === "/api/content/child" && request.method === "POST") return notionChildPage(env, request);
    if (url.pathname === "/api/content/page-child" && request.method === "POST") return notionSitePageChild(env, request);
    if (url.pathname === "/_notion/image" && (request.method === "GET" || request.method === "HEAD")) return notionImage(request);
    if (url.pathname.startsWith("/api/content/post/") && (request.method === "GET" || request.method === "POST")) {
      const slug = decodeURIComponent(url.pathname.slice("/api/content/post/".length));
      return notionPost(env, slug, request);
    }
    if (url.pathname.startsWith("/api/content/page/") && request.method === "GET") {
      const slug = decodeURIComponent(url.pathname.slice("/api/content/page/".length));
      return notionSitePage(env, slug);
    }
    if (url.pathname === "/api/health") return Response.json({ ok: true, notionConfigured: Boolean(env.NOTION_TOKEN) }, { headers: { "cache-control": "no-store" } });

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          if (!env.IMAGES) return new Response(body);
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }
    if (request.method === "GET" && url.pathname.startsWith("/blog/")) {
      const slug = decodeURIComponent(url.pathname.slice("/blog/".length));
      const payload = await articlePayloadForRender(env, slug, request);
      const key = storeArticlePayload(payload);
      const headers = new Headers(request.headers);
      headers.set("x-blog-article-context", key);
      try {
        const rendered = await handler.fetch(new Request(request, { headers }), env, ctx);
        return payload.status && payload.status >= 400 && rendered.status < 400
          ? new Response(rendered.body, { status: payload.status, headers: rendered.headers })
          : rendered;
      }
      finally { clearArticlePayload(key); }
    }
    if (request.method === "GET" && (url.pathname === "/about" || url.pathname.startsWith("/page/"))) {
      const slug = url.pathname === "/about" ? "about" : decodeURIComponent(url.pathname.slice("/page/".length));
      const payload = await sitePagePayloadForRender(env, slug);
      const key = storeArticlePayload(payload);
      const headers = new Headers(request.headers);
      headers.set("x-blog-article-context", key);
      try {
        const rendered = await handler.fetch(new Request(request, { headers }), env, ctx);
        return payload.status && payload.status >= 400 && rendered.status < 400
          ? new Response(rendered.body, { status: payload.status, headers: rendered.headers })
          : rendered;
      }
      finally { clearArticlePayload(key); }
    }
    if (request.method === "GET" && url.pathname === "/") {
      const payload = await homePayloadForRender(env);
      const key = storeHomePayload(payload);
      const headers = new Headers(request.headers);
      headers.set("x-blog-home-context", key);
      try { return await handler.fetch(new Request(request, { headers }), env, ctx); }
      finally { clearHomePayload(key); }
    }
    return handler.fetch(request, env, ctx);
  },
};

async function notionImage(request: Request): Promise<Response> {
  const rawUrl = new URL(request.url).searchParams.get("url");
  let source: URL;
  try { source = new URL(rawUrl || ""); }
  catch { return error(400, "Invalid image URL"); }
  if (source.protocol !== "https:" || !NOTION_IMAGE_HOSTS.has(source.hostname)) return error(400, "Image host is not allowed");
  try {
    const response = await fetch(source, { redirect: "manual" });
    if (!response.ok || !response.body) return error(response.status || 502, "Image is temporarily unavailable");
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].toLocaleLowerCase();
    if (!contentType?.startsWith("image/")) return error(415, "Unsupported image response");
    const headers = new Headers(response.headers);
    headers.set("cache-control", "public, max-age=3600, stale-while-revalidate=86400");
    headers.set("x-content-type-options", "nosniff");
    return request.method === "HEAD" ? new Response(null, { status: response.status, headers }) : new Response(response.body, { status: response.status, headers });
  } catch (reason) {
    console.error(reason instanceof Error ? reason.message : "Notion image fetch failed");
    return error(502, "Image is temporarily unavailable");
  }
}

async function articlePayloadForRender(env: Env, slug: string, request: Request): Promise<ArticlePayload> {
  const response = await notionPost(env, slug, new Request(request.url, { headers: request.headers }));
  const payload = await response.json().catch(() => ({ error: "文章暂时无法读取" })) as ArticlePayload;
  return { ...payload, status: response.status };
}

async function sitePagePayloadForRender(env: Env, slug: string): Promise<ArticlePayload> {
  const response = await notionSitePage(env, slug);
  const payload = await response.json().catch(() => ({ error: "页面暂时无法读取" })) as ArticlePayload;
  return { ...payload, status: response.status };
}

async function homePayloadForRender(env: Env): Promise<HomePayload> {
  const response = await notionPosts(env);
  if (!response.ok) return { posts: [], links: [], config: defaultSiteConfig() };
  const payload = await response.json().catch(() => ({})) as Partial<HomePayload>;
  return {
    posts: Array.isArray(payload.posts) ? payload.posts : [],
    links: Array.isArray(payload.links) ? payload.links : [],
    config: payload.config?.author && payload.config?.since ? payload.config : defaultSiteConfig(),
  };
}

async function notionPosts(env: Env): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  try {
    const [pages, linkPages, config] = await Promise.all([queryPosts(env, undefined, 100), querySiteLinks(env), queryPublicSiteConfig(env).catch(() => defaultSiteConfig())]);
    const posts = pages.map(toPost).filter((post) => post.slug);
    const links = toSiteLinks(linkPages);
    return Response.json({ posts, links, config, source: "notion" }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
  } catch (reason) { return notionError(reason); }
}

async function notionSiteConfig(env: Env): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  try {
    const config = await queryPublicSiteConfig(env);
    return Response.json({ config, source: "notion" }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
  } catch (reason) { return notionError(reason); }
}

async function notionNavigation(env: Env): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  try {
    const linkPages = await querySiteLinks(env);
    const links = toSiteLinks(linkPages);
    return Response.json({ links, source: "notion" }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
  } catch (reason) { return notionError(reason); }
}

async function notionWordCloud(env: Env): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  const cacheKey = env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID;
  const cached = wordCloudCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json(cached.payload, { headers: { ...jsonHeaders, "cache-control": "private, max-age=300" } });
  }

  try {
    const pages = await queryPosts(env, undefined, 100);
    const publicPages = pages.filter((page) => !plain(page.properties?.password));
    let partial = false;
    const documents = (await mapWithConcurrency(publicPages, 3, async (page) => {
      try {
        const state: BlockReadState = { remaining: MAX_WORD_CLOUD_BLOCKS_PER_POST, truncated: false };
        const blocks = await getBlockChildren(env, page.id, state, 0);
        if (state.truncated) partial = true;
        return { id: page.id, title: title(page.properties?.title) || "未命名文章", body: blockText(blocks) };
      } catch (reason) {
        partial = true;
        console.warn(reason instanceof Error ? reason.message : "Word cloud article read failed");
        return null;
      }
    })).filter((document): document is { id: string; title: string; body: string } => Boolean(document));
    const payload: WordCloudPayload = { words: buildWordCloud(documents), sourceCount: documents.length, partial, source: "notion" };
    wordCloudCache.set(cacheKey, { expiresAt: Date.now() + WORD_CLOUD_CACHE_TTL_MS, payload });
    return Response.json(payload, { headers: { ...jsonHeaders, "cache-control": "private, max-age=300" } });
  } catch (reason) { return notionError(reason); }
}

async function notionPost(env: Env, slug: string, request: Request): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  if (!slug || slug.length > 180) return error(400, "Invalid article slug");
  const attemptKey = `${request.headers.get("cf-connecting-ip") || "unknown"}:${slug.toLocaleLowerCase()}`;
  if (request.method === "POST") {
    if (!env.DB) return error(503, "Password protection is temporarily unavailable");
    const attempt = await getPasswordAttemptStatus(env.DB, attemptKey);
    if (!attempt.allowed) return Response.json({ error: "尝试次数过多，请稍后再试" }, { status: 429, headers: { ...jsonHeaders, "cache-control": "no-store", "retry-after": String(attempt.retryAfter) } });
  }
  try {
    const page = await findPost(env, slug);
    if (!page) return error(404, "Article not found");
    const post = toPost(page);
    const expectedPassword = plain(page.properties?.password);
    if (expectedPassword) {
      let supplied = "";
      if (request.method === "POST") {
        const body = await request.json().catch(() => ({})) as { password?: unknown };
        supplied = typeof body.password === "string" ? body.password : "";
      }
      if (supplied !== expectedPassword) {
        if (supplied && env.DB) {
          const failure = await recordPasswordFailure(env.DB, attemptKey);
          if (!failure.allowed) return Response.json({ error: "尝试次数过多，请稍后再试" }, { status: 429, headers: { ...jsonHeaders, "cache-control": "no-store", "retry-after": String(failure.retryAfter) } });
        }
        return Response.json({ post: { ...post, locked: true }, locked: true, error: supplied ? "密码不正确" : undefined }, { status: supplied ? 401 : 200, headers: { ...jsonHeaders, "cache-control": "no-store" } });
      }
      if (env.DB) await clearPasswordAttempts(env.DB, attemptKey);
    }
    const blockState = newBlockReadState();
    const blocks = await getBlockChildren(env, page.id, blockState, 0);
    return Response.json({ post: { ...post, locked: Boolean(expectedPassword) }, locked: false, blocks, truncated: blockState.truncated }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
  } catch (reason) { return notionError(reason); }
}

async function notionSitePage(env: Env, slug: string): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  if (!slug || slug.length > 180) return error(400, "Invalid page slug");
  try {
    const page = await findSitePage(env, slug);
    if (!page) return error(404, "Page not found");
    const blockState = newBlockReadState();
    const blocks = await getBlockChildren(env, page.id, blockState, 0);
    return Response.json({
      post: toSitePagePost(page),
      locked: false,
      blocks,
      truncated: blockState.truncated,
    }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
  } catch (reason) { return notionError(reason); }
}

async function notionChildPage(env: Env, request: Request): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  const body = await request.json().catch(() => ({})) as { slug?: unknown; pageId?: unknown; password?: unknown; trail?: unknown };
  const slug = typeof body.slug === "string" ? body.slug : "";
  const pageId = normalizeNotionId(body.pageId);
  const supplied = typeof body.password === "string" ? body.password : "";
  const trail = Array.isArray(body.trail) ? body.trail.map(normalizeNotionId).filter(Boolean).slice(0, 8) : [];
  if (!slug || slug.length > 180 || !pageId) return error(400, "Invalid child page request");

  try {
    const parent = await findPost(env, slug);
    if (!parent) return error(404, "Article not found");
    const expectedPassword = plain(parent.properties?.password);
    if (expectedPassword) {
      if (!env.DB) return error(503, "Password protection is temporarily unavailable");
      const attemptKey = `${request.headers.get("cf-connecting-ip") || "unknown"}:${slug.toLocaleLowerCase()}`;
      const attempt = await getPasswordAttemptStatus(env.DB, attemptKey);
      if (!attempt.allowed) return Response.json({ error: "尝试次数过多，请稍后再试" }, { status: 429, headers: { ...jsonHeaders, "cache-control": "no-store", "retry-after": String(attempt.retryAfter) } });
      if (supplied !== expectedPassword) {
        if (supplied) {
          const failure = await recordPasswordFailure(env.DB, attemptKey);
          if (!failure.allowed) return Response.json({ error: "尝试次数过多，请稍后再试" }, { status: 429, headers: { ...jsonHeaders, "cache-control": "no-store", "retry-after": String(failure.retryAfter) } });
        }
        return error(supplied ? 401 : 403, supplied ? "密码不正确" : "请先解锁父文章");
      }
      await clearPasswordAttempts(env.DB, attemptKey);
    }

    const childPage = await authorizedChildPage(env, parent, [...trail.filter((id) => id !== pageId), pageId]);
    if (!childPage) return error(404, "Child page not found");
    const blockState = newBlockReadState();
    const blocks = await getBlockChildren(env, childPage.id, blockState, 0);
    return Response.json({ child: {
      id: childPage.id,
      title: notionPageTitle(childPage) || "未命名子页面",
      icon: childPage.icon?.type === "emoji" ? childPage.icon.emoji : undefined,
      blocks,
      truncated: blockState.truncated,
    } }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
  } catch (reason) { return notionError(reason); }
}

async function notionSitePageChild(env: Env, request: Request): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  const body = await request.json().catch(() => ({})) as { slug?: unknown; pageId?: unknown; trail?: unknown };
  const slug = typeof body.slug === "string" ? body.slug : "";
  const pageId = normalizeNotionId(body.pageId);
  const trail = Array.isArray(body.trail) ? body.trail.map(normalizeNotionId).filter(Boolean).slice(0, 8) : [];
  if (!slug || slug.length > 180 || !pageId) return error(400, "Invalid child page request");
  try {
    const parent = await findSitePage(env, slug);
    if (!parent) return error(404, "Page not found");
    const childPage = await authorizedChildPage(env, parent, [...trail.filter((id) => id !== pageId), pageId]);
    if (!childPage) return error(404, "Child page not found");
    const blockState = newBlockReadState();
    const blocks = await getBlockChildren(env, childPage.id, blockState, 0);
    return Response.json({ child: {
      id: childPage.id,
      title: notionPageTitle(childPage) || "未命名子页面",
      icon: childPage.icon?.type === "emoji" ? childPage.icon.emoji : undefined,
      blocks,
      truncated: blockState.truncated,
    } }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
  } catch (reason) { return notionError(reason); }
}

async function notionSitemap(env: Env): Promise<Response> {
  const base = "https://1.530555.xyz";
  let posts: ReturnType<typeof toPost>[] = [];
  let pages: ReturnType<typeof toSitePagePost>[] = [];
  if (env.NOTION_TOKEN) {
    try {
      const [postPages, sitePages] = await Promise.all([queryPosts(env, undefined, 100), querySitePages(env, undefined, 100)]);
      posts = postPages.map(toPost).filter((post) => post.slug);
      pages = sitePages.map(toSitePagePost).filter((page) => page.slug);
    }
    catch (reason) { console.error(reason instanceof Error ? reason.message : "Sitemap Notion request failed"); }
  }
  const urls = [
    `<url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...posts.map((post) => `<url><loc>${base}/blog/${encodeURIComponent(post.slug)}</loc>${post.date ? `<lastmod>${escapeXml(post.date)}</lastmod>` : ""}<changefreq>weekly</changefreq><priority>0.7</priority></url>`),
    ...pages.map((page) => `<url><loc>${base}${sitePagePath(page)}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>`),
  ].join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": env.NOTION_TOKEN ? "no-store" : "public, max-age=60" } });
}

async function notionRss(env: Env): Promise<Response> {
  const base = "https://1.530555.xyz";
  let posts: ReturnType<typeof toPost>[] = [];
  if (env.NOTION_TOKEN) {
    try { posts = (await queryPosts(env, undefined, 100)).map(toPost).filter((post) => post.slug); }
    catch (reason) { console.error(reason instanceof Error ? reason.message : "RSS Notion request failed"); }
  }
  const items = posts.map((post) => {
    const link = `${base}/blog/${encodeURIComponent(post.slug)}`;
    const published = post.date ? new Date(`${post.date}T00:00:00Z`).toUTCString() : "";
    return `<item><title>${escapeXml(post.title)}</title><link>${escapeXml(link)}</link><guid isPermaLink="true">${escapeXml(link)}</guid>${published ? `<pubDate>${published}</pubDate>` : ""}<description>${escapeXml(post.summary)}</description><category>${escapeXml(post.category)}</category></item>`;
  }).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>louis16s&apos; blog</title><link>${base}/</link><description>关于旅行、摄影、开发与生活的个人记录。</description><language>zh-CN</language><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}</channel></rss>`;
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": env.NOTION_TOKEN ? "no-store" : "public, max-age=60" } });
}

async function queryPosts(env: Env, slug?: string, pageSize = 100): Promise<any[]> {
  const filters: any[] = [
    { property: "type", select: { equals: "Post" } },
    { property: "status", select: { equals: "Published" } },
  ];
  if (slug) filters.push({ property: "slug", rich_text: { equals: slug } });
  const results: any[] = [];
  let cursor: string | undefined;
  do {
    const payload = await notionFetch(env, `/data_sources/${env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID}/query`, {
      method: "POST",
      body: JSON.stringify({ filter: { and: filters }, sorts: [{ property: "date", direction: "descending" }], page_size: pageSize, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    if (Array.isArray(payload.results)) results.push(...payload.results);
    cursor = !slug && payload.has_more && typeof payload.next_cursor === "string" ? payload.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function querySitePages(env: Env, slug?: string, pageSize = 100): Promise<any[]> {
  const filters: any[] = [
    { property: "type", select: { equals: "Page" } },
    { property: "status", select: { equals: "Published" } },
  ];
  if (slug) filters.push({ property: "slug", rich_text: { equals: slug } });
  const results: any[] = [];
  let cursor: string | undefined;
  do {
    const payload = await notionFetch(env, `/data_sources/${env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID}/query`, {
      method: "POST",
      body: JSON.stringify({ filter: { and: filters }, sorts: [{ property: "date", direction: "descending" }], page_size: pageSize, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    if (Array.isArray(payload.results)) results.push(...payload.results.filter((page: any) => page.properties?.type?.select?.name === "Page"));
    cursor = !slug && payload.has_more && typeof payload.next_cursor === "string" ? payload.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function findSitePage(env: Env, slug: string): Promise<any | null> {
  const requestedSlug = slug === "about" ? "me" : slug;
  const bySlug = await querySitePages(env, requestedSlug, 1);
  if (bySlug[0]) return bySlug[0];
  const pageId = normalizeNotionId(slug);
  const published = await querySitePages(env, undefined, 100);
  if (pageId) return published.find((page) => normalizeNotionId(page.id) === pageId) || null;
  if (slug === "about") return published.find((page) => {
    const pageTitle = title(page.properties?.title).replace(/_+$/, "");
    return pageTitle.includes("关于");
  }) || null;
  return null;
}

async function findPost(env: Env, slug: string): Promise<any | null> {
  const bySlug = await queryPosts(env, slug, 1);
  if (bySlug[0]) return bySlug[0];

  const pageId = normalizeNotionId(slug);
  if (!pageId) return null;
  const published = await queryPosts(env, undefined, 100);
  return published.find((page) => normalizeNotionId(page.id) === pageId) || null;
}

async function querySiteLinks(env: Env): Promise<any[]> {
  const payload = await notionFetch(env, `/data_sources/${env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID}/query`, {
    method: "POST",
    body: JSON.stringify({
      filter: { and: [
        { property: "status", select: { equals: "Published" } },
        { or: [
          { property: "type", select: { equals: "Menu" } },
          { property: "type", select: { equals: "SubMenu" } },
          { property: "type", select: { equals: "Page" } },
        ] },
      ] },
      sorts: [{ property: "date", direction: "descending" }],
      page_size: 100,
    }),
  });
  return Array.isArray(payload.results) ? payload.results : [];
}

async function queryPublicSiteConfig(env: Env) {
  const pages: any[] = [];
  let cursor: string | undefined;
  do {
    const payload = await notionFetch(env, `/data_sources/${env.NOTION_CONFIG_DATA_SOURCE_ID || DEFAULT_CONFIG_DATA_SOURCE_ID}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    if (Array.isArray(payload.results)) pages.push(...payload.results);
    cursor = payload.has_more && typeof payload.next_cursor === "string" ? payload.next_cursor : undefined;
  } while (cursor);
  return toPublicSiteConfig(pages);
}

type BlockReadState = { remaining: number; truncated: boolean };

function newBlockReadState(): BlockReadState { return { remaining: MAX_BLOCKS, truncated: false }; }

async function getBlockChildren(env: Env, id: string, budget: BlockReadState, depth: number): Promise<any[]> {
  if (depth > MAX_BLOCK_DEPTH || budget.remaining <= 0) { budget.truncated = true; return []; }
  const output: any[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const payload = await notionFetch(env, `/blocks/${id}/children?${query}`);
    for (const raw of payload.results || []) {
      if (budget.remaining-- <= 0) { budget.truncated = true; break; }
      const block = normalizeBlock(raw);
      if (!block) continue;
      const hasInlineChildren = raw.has_children && raw.type !== "child_page" && raw.type !== "child_database";
      if (hasInlineChildren && budget.remaining > 0) block.children = await getBlockChildren(env, raw.id, budget, depth + 1);
      output.push(block);
    }
    if (payload.has_more && budget.remaining <= 0) budget.truncated = true;
    cursor = payload.has_more && budget.remaining > 0 ? payload.next_cursor : undefined;
  } while (cursor);
  return output;
}

async function mapWithConcurrency<T, U>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, run));
  return results;
}

function blockText(blocks: any[]): string {
  const fragments: string[] = [];
  const visit = (items: any[]) => {
    for (const block of items || []) {
      if (block.type === "code") continue;
      const rich = Array.isArray(block.richText) ? block.richText.map((item: any) => item.text || "").join("") : "";
      if (rich) fragments.push(rich);
      if (typeof block.caption === "string" && block.caption) fragments.push(block.caption);
      if (Array.isArray(block.children)) visit(block.children);
    }
  };
  visit(blocks);
  return fragments.join("\n");
}

async function notionFetch(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`https://api.notion.com/v1${path}`, { ...init, headers: { authorization: `Bearer ${env.NOTION_TOKEN}`, "notion-version": NOTION_VERSION, "content-type": "application/json", ...init.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Notion ${response.status}: ${payload.message || "request failed"}`);
  return payload;
}

function toPost(page: any) {
  const properties = page.properties || {};
  const slug = plain(properties.slug) || page.id;
  return {
    id: page.id,
    title: title(properties.title) || "未命名文章",
    slug,
    summary: plain(properties.summary),
    category: properties.category?.select?.name || "未分类",
    tags: (properties.tags?.multi_select || []).map((tag: any) => tag.name).filter(Boolean),
    date: properties.date?.date?.start || page.created_time?.slice(0, 10) || "",
    icon: notionDisplayEmoji(page),
    locked: Boolean(plain(properties.password)),
  };
}

function toSitePagePost(page: any) {
  const properties = page.properties || {};
  return {
    id: page.id,
    title: (title(properties.title) || "未命名页面").replace(/_+$/, ""),
    slug: plain(properties.slug) || page.id,
    summary: plain(properties.summary),
    category: "页面",
    tags: [],
    date: "",
    icon: notionDisplayEmoji(page),
    locked: false,
  };
}

function sitePagePath(page: ReturnType<typeof toSitePagePost>): string {
  return page.slug === "me" || page.title.includes("关于") ? "/about" : `/page/${encodeURIComponent(page.slug)}`;
}

function toSiteLink(page: any) {
  const properties = page.properties || {};
  const menuType = properties.type?.select?.name;
  const linkTitle = (title(properties.title) || "未命名链接").replace(/_+$/, "");
  const pageSlug = plain(properties.slug).trim();
  const isAbout = pageSlug === "me" || linkTitle.includes("关于");
  const configuredTarget = [properties.slug, ...Object.values(properties).filter((property) => property !== properties.slug)]
    .map(notionPropertyLink)
    .find(Boolean) || pageSlug;
  const target = configuredTarget;
  const linkedNotionPageId = notionPageIdFromUrl(target);
  const pageHref = menuType === "Page"
    ? isAbout ? "/about" : pageSlug ? `/page/${encodeURIComponent(pageSlug)}` : `/page/${encodeURIComponent(page.id)}`
    : menuType === "Menu" && isAbout ? "/about"
    : menuType === "Menu" && linkedNotionPageId ? `/page/${encodeURIComponent(linkedNotionPageId)}`
    : "";
  const external = !pageHref && /^https?:\/\//i.test(target);
  const internal = /^\/(?!\/)/.test(target);
  const rss = /^\/?rss(?:\/feed\.xml|\.xml)?\/?$/i.test(target)
    || /^rss(?:\s|$)/i.test(linkTitle);
  const href = rss ? "/rss.xml" : pageHref || (external || internal ? normalizeInternalNavigationTarget(target) : "");
  return {
    id: page.id,
    title: linkTitle,
    href,
    summary: plain(properties.summary),
    icon: notionDisplayEmoji(page),
    external,
    kind: rss ? "rss" as const : menuType === "Menu" || menuType === "Page" ? "nav" as const : "tool" as const,
  };
}

function toSiteLinks(pages: any[]) {
  const contentPages = pages.filter((page) => page.properties?.type?.select?.name === "Page");
  const linkedPageIds = new Set<string>();
  const candidates: ReturnType<typeof toSiteLink>[] = [];

  for (const page of pages) {
    const type = page.properties?.type?.select?.name;
    if (type === "Page") continue;
    const menuLink = toSiteLink(page);
    if (type !== "Menu" || menuLink.kind === "rss") {
      candidates.push(menuLink);
      continue;
    }

    const menuTitle = title(page.properties?.title).replace(/_+$/, "").trim();
    const menuSlug = plain(page.properties?.slug).trim();
    const targetId = Object.values(page.properties || {})
      .map(notionPropertyLink)
      .map(notionPageIdFromUrl)
      .find(Boolean);
    const matchedPage = contentPages.find((contentPage) => {
      const pageTitle = title(contentPage.properties?.title).replace(/_+$/, "").trim();
      const pageSlug = plain(contentPage.properties?.slug).trim();
      return (targetId && normalizeNotionId(contentPage.id) === targetId)
        || (menuSlug && menuSlug === pageSlug)
        || (menuTitle && menuTitle === pageTitle);
    });
    if (!matchedPage) {
      candidates.push(menuLink);
      continue;
    }
    linkedPageIds.add(normalizeNotionId(matchedPage.id));
    candidates.push({
      ...menuLink,
      href: sitePagePath(toSitePagePost(matchedPage)),
      external: false,
      kind: "nav",
    });
  }

  for (const page of contentPages) {
    if (!linkedPageIds.has(normalizeNotionId(page.id))) candidates.push(toSiteLink(page));
  }

  const seen = new Set<string>();
  return candidates.filter((link) => {
    if (!link.href) return false;
    const identity = `${link.kind}:${link.href}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function notionPropertyLink(property: any): string {
  if (typeof property?.url === "string") return safeNavigationTarget(property.url);
  const rich = property?.rich_text || property?.title;
  if (!Array.isArray(rich)) return "";
  for (const item of rich) {
    const linked = item?.href || item?.text?.link?.url || item?.mention?.link_preview?.url;
    const safe = safeNavigationTarget(linked);
    if (safe) return safe;
  }
  return "";
}

function notionDisplayEmoji(page: any): string {
  if (page.icon?.type === "emoji" && typeof page.icon.emoji === "string") return page.icon.emoji;
  const legacyIcon = plain(page.properties?.icon).trim();
  return LEGACY_EMOJI_PATTERN.test(legacyIcon) ? legacyIcon : "";
}

function safeNavigationTarget(value: unknown): string {
  if (typeof value !== "string") return "";
  const target = value.trim();
  return /^https?:\/\//i.test(target) || /^\/(?!\/)/.test(target) ? target : "";
}

function normalizeInternalNavigationTarget(target: string): string {
  if (/^\/archive\/?$/i.test(target)) return "/#archive";
  if (/^\/about\/?$/i.test(target)) return "/#about";
  return target;
}

async function authorizedChildPage(env: Env, rootPage: any, path: string[]): Promise<any | null> {
  let currentPage = rootPage;
  for (const pageId of path) {
    const currentId = normalizeNotionId(currentPage.id);
    if (!currentId || pageId === currentId) return null;
    let candidate = await descendantPage(env, pageId, currentId);
    if (!candidate) {
      const referenceState = newBlockReadState();
      const blocks = await getBlockChildren(env, currentPage.id, referenceState, 0);
      if (!referencesPage(blocks, pageId)) return null;
      candidate = await notionFetch(env, `/pages/${pageId}`);
    }
    currentPage = candidate;
  }
  return currentPage === rootPage ? null : currentPage;
}

function referencesPage(blocks: any[], pageId: string): boolean {
  for (const block of blocks) {
    if (normalizeNotionId(block.pageId) === pageId) return true;
    if (block.richText?.some((item: any) => notionPageIdFromUrl(item.href) === pageId)) return true;
    if (block.children?.length && referencesPage(block.children, pageId)) return true;
  }
  return false;
}

function notionPageIdFromUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (!/(^|\.)notion\.(?:so|site|com)$/i.test(url.hostname)) return "";
    const match = url.pathname.replaceAll("-", "").match(/([a-f0-9]{32})\/?$/i);
    return normalizeNotionId(match?.[1]);
  } catch { return ""; }
}

async function descendantPage(env: Env, childId: string, ancestorId: string): Promise<any | null> {
  let currentId = childId;
  let targetPage: any | null = null;
  for (let depth = 0; depth < 8; depth++) {
    const page = await notionFetch(env, `/pages/${currentId}`);
    if (!targetPage) targetPage = page;
    const parentId = normalizeNotionId(page.parent?.page_id);
    if (!parentId) return null;
    if (parentId === ancestorId) return targetPage;
    currentId = parentId;
  }
  return null;
}

function normalizeNotionId(value: unknown): string {
  if (typeof value !== "string") return "";
  const compact = value.replaceAll("-", "").toLocaleLowerCase();
  if (!/^[a-f0-9]{32}$/.test(compact)) return "";
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function notionPageTitle(page: any): string {
  const property = Object.values(page.properties || {}).find((value: any) => value?.type === "title" || Array.isArray(value?.title));
  return title(property);
}

function defaultSiteConfig() { return { author: "louis16s", since: "2020" }; }

function toPublicSiteConfig(pages: any[]) {
  const config = defaultSiteConfig();
  for (const page of pages) {
    const properties = page.properties || {};
    if (properties["启用"]?.checkbox !== true) continue;
    const key = title(properties["配置名"]).replaceAll("`", "").trim().toLocaleUpperCase();
    const value = plain(properties["配置值"]).trim();
    if (key === "AUTHOR" && value) config.author = value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80) || config.author;
    if (key === "SINCE") config.since = value.match(/(?:19|20)\d{2}/)?.[0] || config.since;
  }
  return config;
}

function title(property: any): string { return richText(property?.title); }
function plain(property: any): string { return richText(property?.rich_text || property?.title || property); }
function richText(value: any): string { return Array.isArray(value) ? value.map((item) => item.plain_text || item.text?.content || "").join("") : typeof value === "string" ? value : ""; }

function normalizeRichText(value: any[] = []) {
  return value.map((item) => ({
    text: item.plain_text || item.text?.content || "",
    href: item.href || undefined,
    bold: item.annotations?.bold || undefined,
    italic: item.annotations?.italic || undefined,
    code: item.annotations?.code || undefined,
    strikethrough: item.annotations?.strikethrough || undefined,
    underline: item.annotations?.underline || undefined,
    color: item.annotations?.color && item.annotations.color !== "default" ? item.annotations.color : undefined,
  }));
}

const BOOKMARK_TITLES: Record<string, string> = {
  "ifanr.com": "爱范儿",
  "ruanyifeng.com": "阮一峰的网络日志",
  "sspai.com": "少数派",
  "v2ex.com": "V2EX",
  "chiphell.com": "Chiphell",
  "topys.cn": "TOPYS",
};

function bookmarkTitle(url: unknown): string {
  if (typeof url !== "string") return "网页链接";
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./i, "").toLocaleLowerCase();
    if (BOOKMARK_TITLES[hostname]) return BOOKMARK_TITLES[hostname];
    const stem = hostname.split(".")[0].replace(/[-_]+/g, " ").trim();
    return stem ? stem.replace(/\b\w/g, (letter) => letter.toLocaleUpperCase()) : "网页链接";
  } catch {
    return "网页链接";
  }
}

function normalizeBlock(raw: any): any | null {
  const type = raw.type;
  const value = raw[type] || {};
  const base: any = { id: raw.id, type, color: value.color && value.color !== "default" ? value.color : undefined };
  if (Array.isArray(value.rich_text)) base.richText = normalizeRichText(value.rich_text);
  switch (type) {
    case "paragraph": case "heading_1": case "heading_2": case "heading_3": case "bulleted_list_item": case "numbered_list_item": case "quote": case "toggle": case "column": case "column_list": case "synced_block": case "table": case "table_of_contents": case "breadcrumb": case "template": return base;
    case "to_do": return { ...base, checked: Boolean(value.checked) };
    case "callout": return { ...base, icon: value.icon?.emoji || "i" };
    case "code": return { ...base, language: value.language || "plain text", caption: richText(value.caption) };
    case "divider": return base;
    case "image": {
      const url = value.type === "external" ? value.external?.url : value.file?.url;
      return { ...base, url: needsBrowserImageConversion(url) ? `/_notion/image?url=${encodeURIComponent(url)}` : url, caption: richText(value.caption) };
    }
    case "bookmark": case "embed": case "video": case "file": case "pdf": case "audio": case "link_preview": {
      const url = value.url || value.external?.url || value.file?.url;
      const normalizedType = type === "video" ? "embed" : type === "link_preview" ? "bookmark" : type;
      const caption = richText(value.caption) || (normalizedType === "bookmark" ? bookmarkTitle(url) : "");
      return { ...base, type: normalizedType, url, caption };
    }
    case "child_page": return { ...base, caption: value.title || "子页面", pageId: normalizeNotionId(raw.id) };
    case "child_database": return { ...base, caption: value.title || "子数据库", url: `https://www.notion.so/${String(raw.id).replaceAll("-", "")}` };
    case "equation": return { ...base, caption: value.expression || "" };
    case "table_row": return { ...base, children: (value.cells || []).map((cell: any[], index: number) => ({ id: `${raw.id}-cell-${index}`, type: "table_cell", richText: normalizeRichText(cell) })) };
    case "unsupported": return { ...base, type: "unsupported" };
    default: return raw.has_children ? base : { ...base, type: "unsupported" };
  }
}

function needsBrowserImageConversion(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const source = new URL(url);
    return NOTION_IMAGE_HOSTS.has(source.hostname) && /\.(?:heic|heif)$/i.test(decodeURIComponent(source.pathname));
  }
  catch { return false; }
}

function escapeXml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char] || char)); }

function withHead(request: Request, response: Response) {
  return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
}

function error(status: number, message: string) { return Response.json({ error: message }, { status, headers: { ...jsonHeaders, "cache-control": "no-store" } }); }
function notionError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "Notion request failed";
  console.error(message);
  return error(502, "文章暂时无法读取");
}

export default worker;
