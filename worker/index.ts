/** Cloudflare Worker entry point with a small Notion content gateway. */
/* eslint-disable @typescript-eslint/no-explicit-any -- Notion block/property unions are normalized at this gateway boundary. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { clearPasswordAttempts, getPasswordAttemptStatus, recordPasswordFailure } from "../db/rate-limit";
import { clearArticlePayload, storeArticlePayload, type ArticlePayload } from "../server/article-context";
import { clearHomePayload, storeHomePayload, type HomePayload } from "../server/home-context";
import { buildWordCloud, normalizeSearchText } from "../shared/wordCloud.js";

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
const MAX_INDEX_BLOCKS_PER_POST = 800;
const MAX_CHILD_BLOCKS_PER_CHUNK = 2_000;
const WORD_CLOUD_CACHE_TTL_MS = 10 * 60 * 1000;
const RSS_FEED_CACHE_TTL_MS = 15 * 60 * 1000;
const LINK_PREVIEW_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SITE_BOOTSTRAP_CACHE_TTL_MS = 5 * 60 * 1000;
const SITE_BOOTSTRAP_STALE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RSS_FEEDS = 8;
const LEGACY_EMOJI_PATTERN = /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)$/u;
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" };
const publicContentHeaders = { ...jsonHeaders, "cache-control": "no-cache, max-age=0, must-revalidate" };
const edgeBootstrapHeaders = { ...jsonHeaders, "cache-control": "public, max-age=300, stale-while-revalidate=86400" };
const wordCloudCache = new Map<string, { expiresAt: number; payload: WordCloudPayload }>();
const publicCorpusCache = new Map<string, { expiresAt: number; corpus: PublicCorpus }>();
const rssFeedCache = new Map<string, { expiresAt: number; feed: ExternalFeed | null }>();
const linkPreviewCache = new Map<string, { expiresAt: number; preview: LinkPreview }>();
const siteBootstrapCache = new Map<string, { freshUntil: number; staleUntil: number; payload?: HomePayload; pending?: Promise<HomePayload> }>();

type WordCloudPayload = { words: ReturnType<typeof buildWordCloud>; sourceCount: number; partial: boolean; source: "notion" };
type SearchDocument = ReturnType<typeof toPost> & { body: string; searchBody: string };
type PublicCorpus = { documents: SearchDocument[]; partial: boolean };
type ExternalFeedItem = { id: string; title: string; url: string; published: string; summary: string };
type ExternalFeed = { url: string; title: string; source: string; items: ExternalFeedItem[] };
type LinkPreview = { title: string; subtitle: string; source: string };
type WorkerCacheStorage = CacheStorage & { default?: Cache };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/sitemap.xml" && (request.method === "GET" || request.method === "HEAD")) return withHead(request, await notionSitemap(env));
    if (url.pathname === "/rss.xml" && (request.method === "GET" || request.method === "HEAD")) return withHead(request, await notionRss(env));
    if (url.pathname === "/api/content/posts" && (request.method === "GET" || request.method === "HEAD")) return withHead(request, await notionPosts(env, request, ctx));
    if (url.pathname === "/api/content/navigation" && request.method === "GET") return notionNavigation(env);
    if (url.pathname === "/api/content/config" && request.method === "GET") return notionSiteConfig(env);
    if (url.pathname === "/api/content/search" && request.method === "GET") return notionSearch(env, url);
    if (url.pathname === "/api/content/rss-feeds" && request.method === "GET") return notionExternalRss(env, url);
    if (url.pathname === "/api/content/link-preview" && request.method === "GET") return externalLinkPreview(url);
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
      const payload = await homePayloadForRender(env, request, ctx);
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

function siteBootstrapCacheKey(env: Env): string {
  return `${env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID}:${env.NOTION_CONFIG_DATA_SOURCE_ID || DEFAULT_CONFIG_DATA_SOURCE_ID}`;
}

async function querySiteBootstrap(env: Env): Promise<HomePayload> {
  const [pages, linkPages, config] = await Promise.all([
    queryPosts(env, undefined, 100),
    querySiteLinks(env),
    queryPublicSiteConfig(env).catch(() => defaultSiteConfig()),
  ]);
  return {
    posts: pages.map(toPost).filter((post) => post.slug),
    links: toSiteLinks(linkPages),
    config,
  };
}

async function getSiteBootstrap(env: Env): Promise<HomePayload> {
  if (!env.NOTION_TOKEN) throw new Error("Notion connection is not configured");
  const key = siteBootstrapCacheKey(env);
  const now = Date.now();
  const cached = siteBootstrapCache.get(key);
  if (cached?.payload && cached.freshUntil > now) return cached.payload;
  if (cached?.pending) return cached.pending;

  const pending = querySiteBootstrap(env)
    .then((payload) => {
      siteBootstrapCache.set(key, {
        payload,
        freshUntil: Date.now() + SITE_BOOTSTRAP_CACHE_TTL_MS,
        staleUntil: Date.now() + SITE_BOOTSTRAP_STALE_TTL_MS,
      });
      if (siteBootstrapCache.size > 8) {
        const oldestKey = siteBootstrapCache.keys().next().value;
        if (oldestKey && oldestKey !== key) siteBootstrapCache.delete(oldestKey);
      }
      return payload;
    })
    .catch((reason) => {
      if (cached?.payload && cached.staleUntil > now) {
        siteBootstrapCache.set(key, {
          payload: cached.payload,
          freshUntil: now + 10_000,
          staleUntil: cached.staleUntil,
        });
        return cached.payload;
      }
      siteBootstrapCache.delete(key);
      throw reason;
    });

  siteBootstrapCache.set(key, {
    payload: cached?.payload,
    freshUntil: cached?.freshUntil || 0,
    staleUntil: cached?.staleUntil || 0,
    pending,
  });
  return pending;
}

function defaultWorkerCache(): Cache | undefined {
  return (globalThis as typeof globalThis & { caches?: WorkerCacheStorage }).caches?.default;
}

function siteBootstrapEdgeKey(env: Env, request: Request): Request {
  const url = new URL(request.url);
  url.protocol = "https:";
  url.hostname = "1.530555.xyz";
  url.pathname = "/__blog-cache/site-bootstrap";
  url.search = "";
  url.searchParams.set("schema", "2");
  url.searchParams.set("data", env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID);
  url.searchParams.set("config", env.NOTION_CONFIG_DATA_SOURCE_ID || DEFAULT_CONFIG_DATA_SOURCE_ID);
  return new Request(url.toString(), { method: "GET" });
}

async function homePayloadForRender(env: Env, request: Request, ctx: ExecutionContext): Promise<HomePayload> {
  if (!env.NOTION_TOKEN) return { posts: [], links: [], config: defaultSiteConfig() };
  const endpoint = new URL("/api/content/posts", request.url);
  const response = await notionPosts(env, new Request(endpoint, { headers: request.headers }), ctx);
  if (!response.ok) return { posts: [], links: [], config: defaultSiteConfig() };
  const payload = await response.json().catch(() => ({})) as Partial<HomePayload>;
  return {
    posts: Array.isArray(payload.posts) ? payload.posts : [],
    links: Array.isArray(payload.links) ? payload.links : [],
    config: payload.config?.author && payload.config?.since ? payload.config : defaultSiteConfig(),
  };
}

async function notionPosts(env: Env, request?: Request, ctx?: ExecutionContext): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  try {
    const cache = request ? defaultWorkerCache() : undefined;
    const cacheKey = request && cache ? siteBootstrapEdgeKey(env, request) : undefined;
    if (cache && cacheKey) {
      const cached = await cache.match(cacheKey).catch(() => undefined);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set("cache-control", publicContentHeaders["cache-control"]);
        headers.set("x-blog-cache", "hit");
        return new Response(cached.body, { status: cached.status, headers });
      }
    }
    const payload = await getSiteBootstrap(env);
    const body = { ...payload, source: "notion" };
    const response = Response.json(body, { headers: { ...publicContentHeaders, "x-blog-cache": "miss" } });
    if (cache && cacheKey && ctx) {
      const edgeResponse = Response.json(body, { headers: edgeBootstrapHeaders });
      ctx.waitUntil(cache.put(cacheKey, edgeResponse).catch((reason) => {
        console.warn(reason instanceof Error ? reason.message : "Site bootstrap cache write failed");
      }));
    }
    return response;
  } catch (reason) { return notionError(reason); }
}

async function notionSiteConfig(env: Env): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  try {
    const config = await queryPublicSiteConfig(env);
    return Response.json({ config, source: "notion" }, { headers: publicContentHeaders });
  } catch (reason) { return notionError(reason); }
}

async function notionNavigation(env: Env): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  try {
    const linkPages = await querySiteLinks(env);
    const links = toSiteLinks(linkPages);
    return Response.json({ links, source: "notion" }, { headers: publicContentHeaders });
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
    const corpus = await getPublicCorpus(env);
    const payload: WordCloudPayload = {
      words: buildWordCloud(corpus.documents.map(({ id, title, body }) => ({ id, title, body }))),
      sourceCount: corpus.documents.length,
      partial: corpus.partial,
      source: "notion",
    };
    wordCloudCache.set(cacheKey, { expiresAt: Date.now() + WORD_CLOUD_CACHE_TTL_MS, payload });
    return Response.json(payload, { headers: { ...jsonHeaders, "cache-control": "private, max-age=300" } });
  } catch (reason) { return notionError(reason); }
}

async function notionSearch(env: Env, url: URL): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  const query = normalizeSearchText(url.searchParams.get("q") || "");
  const warming = url.searchParams.get("warm") === "1";
  if (!query && !warming) return Response.json({ matches: [], partial: false, source: "notion" }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
  if (query.length > 100) return error(400, "Search query is too long");
  try {
    const corpus = await getPublicCorpus(env);
    if (warming) return Response.json({ matches: [], warmed: true, partial: corpus.partial, source: "notion" }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
    const matches = corpus.documents
      .filter((document) => normalizeSearchText([
        document.title,
        document.summary,
        document.category,
        ...document.tags,
        document.searchBody,
      ].join("\n")).includes(query))
      .map((document) => document.id);
    return Response.json({ matches, partial: corpus.partial, source: "notion" }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
  } catch (reason) { return notionError(reason); }
}

async function notionExternalRss(env: Env, url: URL): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  const slug = url.searchParams.get("slug") || "";
  if (!slug || slug.length > 180) return error(400, "Invalid page slug");
  try {
    const page = await findSitePage(env, slug);
    if (!page) return error(404, "Page not found");
    const state = newBlockReadState();
    const blocks = await getBlockChildren(env, page.id, state, 0);
    const urls = extractExternalUrls(blocks).slice(0, MAX_RSS_FEEDS);
    const feeds = (await mapWithConcurrency(urls, 3, (feedUrl) => fetchExternalFeed(feedUrl)))
      .filter((feed): feed is ExternalFeed => Boolean(feed));
    return Response.json({ feeds, partial: state.truncated, source: "notion" }, { headers: { ...jsonHeaders, "cache-control": "private, max-age=300" } });
  } catch (reason) { return notionError(reason); }
}

function extractExternalUrls(blocks: any[]): string[] {
  const urls = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string" || !isSafeExternalUrl(value)) return;
    urls.add(value.trim());
  };
  const visit = (items: any[]) => {
    for (const block of items || []) {
      add(block.url);
      for (const item of block.richText || []) {
        add(item.href);
        for (const match of String(item.text || "").matchAll(/https?:\/\/[^\s<>()]+/gi)) add(match[0]);
      }
      if (Array.isArray(block.children)) visit(block.children);
    }
  };
  visit(blocks);
  return [...urls];
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLocaleLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (/^(?:0|10|127)\.|^169\.254\.|^172\.(?:1[6-9]|2\d|3[0-1])\.|^192\.168\./.test(host)) return false;
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return false;
    return true;
  } catch { return false; }
}

function bookmarkSource(value: string): string {
  try { return new URL(value).hostname.replace(/^www\./i, ""); }
  catch { return value; }
}

async function externalLinkPreview(url: URL): Promise<Response> {
  const target = url.searchParams.get("url")?.trim() || "";
  if (!target || target.length > 2_048 || !isSafeExternalUrl(target)) return error(400, "Invalid link URL");
  const cached = linkPreviewCache.get(target);
  if (cached && cached.expiresAt > Date.now()) return Response.json(cached.preview, { headers: { ...jsonHeaders, "cache-control": "public, max-age=21600" } });
  const fallback: LinkPreview = { title: "", subtitle: "", source: bookmarkSource(target) };
  try {
    let current = target;
    for (let redirect = 0; redirect < 4; redirect++) {
      const response = await fetch(current, {
        redirect: "manual",
        headers: { accept: "text/html,application/xhtml+xml;q=0.9", "user-agent": "blogonCF link preview" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) break;
        const next = new URL(location, current).toString();
        if (!isSafeExternalUrl(next)) break;
        current = next;
        continue;
      }
      if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") || "")) break;
      const declaredSize = Number(response.headers.get("content-length") || "0");
      if (declaredSize > 600_000) break;
      const html = await readLimitedText(response, 600_000);
      const metadata = htmlMetadata(html);
      const preview: LinkPreview = {
        title: metadata.title,
        subtitle: metadata.subtitle,
        source: bookmarkSource(current),
      };
      linkPreviewCache.set(target, { expiresAt: Date.now() + LINK_PREVIEW_CACHE_TTL_MS, preview });
      if (linkPreviewCache.size > 300) linkPreviewCache.delete(linkPreviewCache.keys().next().value as string);
      return Response.json(preview, { headers: { ...jsonHeaders, "cache-control": "public, max-age=21600" } });
    }
  } catch { /* A compact domain-only card is the intended fallback. */ }
  linkPreviewCache.set(target, { expiresAt: Date.now() + 10 * 60 * 1000, preview: fallback });
  return Response.json(fallback, { headers: { ...jsonHeaders, "cache-control": "public, max-age=600" } });
}

async function readLimitedText(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error("Link preview is too large"); }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

function htmlMetadata(html: string): { title: string; subtitle: string } {
  const meta = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map<string, string>();
    for (const attribute of match[0].matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes.set(attribute[1].toLocaleLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
    }
    const key = (attributes.get("property") || attributes.get("name") || "").toLocaleLowerCase();
    const content = attributes.get("content") || "";
    if (key && content && !meta.has(key)) meta.set(key, content);
  }
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = cleanMetadata(meta.get("og:title") || meta.get("twitter:title") || titleMatch?.[1] || "", 140);
  const subtitle = cleanMetadata(meta.get("og:description") || meta.get("description") || meta.get("twitter:description") || "", 240);
  return { title, subtitle };
}

function cleanMetadata(value: string, limit: number): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, limit);
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== "#") return named[code.toLocaleLowerCase()] || entity;
    const numeric = code[1]?.toLocaleLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    try { return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity; } catch { return entity; }
  });
}

async function fetchExternalFeed(feedUrl: string): Promise<ExternalFeed | null> {
  const cached = rssFeedCache.get(feedUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.feed;
  let current = feedUrl;
  try {
    for (let redirect = 0; redirect < 3; redirect++) {
      const response = await fetch(current, { redirect: "manual", headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9" } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) break;
        const next = new URL(location, current).toString();
        if (!isSafeExternalUrl(next)) break;
        current = next;
        continue;
      }
      if (!response.ok) break;
      const length = Number(response.headers.get("content-length") || "0");
      if (length > 1_000_000) break;
      const xml = await response.text();
      if (xml.length > 1_000_000) break;
      const feed = parseExternalFeed(xml, current);
      rssFeedCache.set(feedUrl, { expiresAt: Date.now() + RSS_FEED_CACHE_TTL_MS, feed });
      return feed;
    }
  } catch (reason) { console.warn(reason instanceof Error ? reason.message : "External RSS fetch failed"); }
  rssFeedCache.set(feedUrl, { expiresAt: Date.now() + RSS_FEED_CACHE_TTL_MS, feed: null });
  return null;
}

function parseExternalFeed(xml: string, feedUrl: string): ExternalFeed | null {
  const isAtom = /<feed\b/i.test(xml);
  const chunks = [...xml.matchAll(isAtom ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi : /<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  if (!chunks.length) return null;
  const source = externalSource(feedUrl);
  const feedTitle = xmlField(xml, "title") || source;
  const items = chunks.slice(0, 15).map((chunk, index) => {
    const url = isAtom ? atomLink(chunk) : xmlField(chunk, "link");
    const title = xmlField(chunk, "title") || "未命名动态";
    const published = xmlField(chunk, isAtom ? "updated" : "pubDate") || xmlField(chunk, isAtom ? "published" : "dc:date");
    const summary = xmlField(chunk, isAtom ? "summary" : "description") || xmlField(chunk, isAtom ? "content" : "content:encoded");
    return { id: `${feedUrl}#${url || index}`, title, url: isSafeExternalUrl(url) ? url : feedUrl, published, summary };
  }).filter((item) => item.title);
  return items.length ? { url: feedUrl, title: feedTitle, source, items } : null;
}

function atomLink(xml: string): string {
  const match = xml.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  return match?.[1] ? decodeXml(match[1]) : "";
}

function xmlField(xml: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match?.[1] ? decodeXml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()) : "";
}

function decodeXml(value: string): string {
  return value.replace(/&#x([\da-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal))).replace(/&(?:amp|lt|gt|quot|apos);/gi, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" }[entity.toLocaleLowerCase()] || entity));
}

function externalSource(value: string): string {
  try { return new URL(value).hostname.replace(/^www\./i, ""); }
  catch { return "RSS"; }
}

async function getPublicCorpus(env: Env): Promise<PublicCorpus> {
  const cacheKey = env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID;
  const cached = publicCorpusCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.corpus;

  const pages = await queryPosts(env, undefined, 100);
  const publicPages = pages.filter((page) => !plain(page.properties?.password));
  let partial = false;
  const documents = await mapWithConcurrency(publicPages, 2, async (page) => {
    try {
      const state: BlockReadState = { remaining: MAX_INDEX_BLOCKS_PER_POST, truncated: false };
      const blocks = await getBlockChildren(env, page.id, state, 0);
      if (state.truncated) partial = true;
      return { ...toPost(page), body: blockText(blocks), searchBody: blockText(blocks, true) };
    } catch (reason) {
      partial = true;
      console.warn(reason instanceof Error ? reason.message : "Public article index read failed");
      return { ...toPost(page), body: "", searchBody: "" };
    }
  });
  const corpus = { documents, partial };
  publicCorpusCache.set(cacheKey, { expiresAt: Date.now() + WORD_CLOUD_CACHE_TTL_MS, corpus });
  return corpus;
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
  const body = await request.json().catch(() => ({})) as { slug?: unknown; pageId?: unknown; password?: unknown; trail?: unknown; cursor?: unknown };
  const slug = typeof body.slug === "string" ? body.slug : "";
  const pageId = normalizeNotionId(body.pageId);
  const supplied = typeof body.password === "string" ? body.password : "";
  const trail = Array.isArray(body.trail) ? body.trail.map(normalizeNotionId).filter(Boolean).slice(0, 8) : [];
  const cursor = normalizeNotionCursor(body.cursor);
  if (!slug || slug.length > 180 || !pageId || (body.cursor != null && !cursor)) return error(400, "Invalid child page request");

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
    return childPageResponse(env, childPage, cursor);
  } catch (reason) { return notionError(reason); }
}

async function notionSitePageChild(env: Env, request: Request): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  const body = await request.json().catch(() => ({})) as { slug?: unknown; pageId?: unknown; trail?: unknown; cursor?: unknown };
  const slug = typeof body.slug === "string" ? body.slug : "";
  const pageId = normalizeNotionId(body.pageId);
  const trail = Array.isArray(body.trail) ? body.trail.map(normalizeNotionId).filter(Boolean).slice(0, 8) : [];
  const cursor = normalizeNotionCursor(body.cursor);
  if (!slug || slug.length > 180 || !pageId || (body.cursor != null && !cursor)) return error(400, "Invalid child page request");
  try {
    const parent = await findSitePage(env, slug);
    if (!parent) return error(404, "Page not found");
    const childPage = await authorizedChildPage(env, parent, [...trail.filter((id) => id !== pageId), pageId]);
    if (!childPage) return error(404, "Child page not found");
    return childPageResponse(env, childPage, cursor);
  } catch (reason) { return notionError(reason); }
}

async function childPageResponse(env: Env, childPage: any, cursor: string): Promise<Response> {
  const blockState: BlockReadState = { remaining: MAX_CHILD_BLOCKS_PER_CHUNK, truncated: false };
  const page = await getBlockChildrenPage(env, childPage.id, blockState, 0, cursor);
  return Response.json({ child: {
    id: childPage.id,
    title: notionPageTitle(childPage) || "未命名子页面",
    icon: childPage.icon?.type === "emoji" ? childPage.icon.emoji : undefined,
    blocks: page.blocks,
    hasMore: Boolean(page.nextCursor),
    nextCursor: page.nextCursor,
    truncated: blockState.truncated,
  } }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
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

async function getBlockChildrenPage(env: Env, id: string, budget: BlockReadState, depth: number, cursor = "") {
  if (depth > MAX_BLOCK_DEPTH || budget.remaining <= 0) {
    budget.truncated = true;
    return { blocks: [] as any[], nextCursor: undefined as string | undefined };
  }
  const query = new URLSearchParams({ page_size: "100" });
  if (cursor) query.set("start_cursor", cursor);
  const payload = await notionFetch(env, `/blocks/${id}/children?${query}`);
  const blocks: any[] = [];
  for (const raw of payload.results || []) {
    if (budget.remaining-- <= 0) { budget.truncated = true; break; }
    const block = normalizeBlock(raw);
    if (!block) continue;
    const hasInlineChildren = raw.has_children && raw.type !== "child_page" && raw.type !== "child_database";
    if (hasInlineChildren && budget.remaining > 0) block.children = await getBlockChildren(env, raw.id, budget, depth + 1);
    blocks.push(block);
  }
  const nextCursor = payload.has_more && budget.remaining > 0 && typeof payload.next_cursor === "string"
    ? normalizeNotionCursor(payload.next_cursor) || undefined
    : undefined;
  if (payload.has_more && !nextCursor) budget.truncated = true;
  return { blocks, nextCursor };
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

function blockText(blocks: any[], includeCode = false): string {
  const fragments: string[] = [];
  const visit = (items: any[]) => {
    for (const block of items || []) {
      if (block.type === "code" && !includeCode) continue;
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
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(`https://api.notion.com/v1${path}`, { ...init, headers: { authorization: `Bearer ${env.NOTION_TOKEN}`, "notion-version": NOTION_VERSION, "content-type": "application/json", ...init.headers } });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return payload;
    if (response.status !== 429 || attempt === 4) throw new Error(`Notion ${response.status}: ${payload.message || "request failed"}`);
    const retryHeader = response.headers.get("retry-after");
    const retryAfter = retryHeader === null ? Number.NaN : Number(retryHeader);
    const delay = Number.isFinite(retryAfter) ? Math.max(0, retryAfter * 1000) : 350 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 3_000)));
  }
  throw new Error("Notion request failed after retries");
}

function toPost(page: any) {
  const properties = page.properties || {};
  const slug = plain(properties.slug) || page.id;
  const locked = Boolean(plain(properties.password));
  return {
    id: page.id,
    title: title(properties.title) || "未命名文章",
    slug,
    // Keep every user-controlled metadata field out of the public response for
    // locked posts. A Notion summary can accidentally duplicate the password.
    summary: locked ? "" : plain(properties.summary),
    category: properties.category?.select?.name || "未分类",
    tags: (properties.tags?.multi_select || []).map((tag: any) => tag.name).filter(Boolean),
    date: properties.date?.date?.start || page.created_time?.slice(0, 10) || "",
    icon: notionDisplayEmoji(page),
    locked,
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

function normalizeNotionCursor(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) return "";
  return value;
}

function notionPageTitle(page: any): string {
  const property = Object.values(page.properties || {}).find((value: any) => value?.type === "title" || Array.isArray(value?.title));
  return title(property);
}

const DEFAULT_FOOTER_QUOTES = [
  { lead: "页面看到底了。喝口水，再随便逛逛。", sub: "偶尔拍照，或是写代码，剩下的时间用来对焦生活。" },
  { lead: "这一页先停在这里。窗外或许正好有光。", sub: "把日子调到合适的曝光，也给自己留一点余量。" },
  { lead: "读到这里，算是一起走了一小段路。", sub: "照片留住瞬间，文字替它慢慢显影。" },
  { lead: "页面有尽头，想法暂时没有。", sub: "生活不必一直清晰，偶尔失焦也很好。" },
  { lead: "先看到这里吧。下一次打开，也许又是另一种天气。", sub: "相机负责取景，代码负责运转，日子负责发生。" },
  { lead: "翻页之前，先听一会儿周围的声音。", sub: "认真记录，也认真错过，这些都算生活。" },
  { lead: "这一卷写完了，下一卷还在路上。", sub: "慢一点按下快门，也慢一点得出答案。" },
  { lead: "感谢看到最后。这里没有结论，只有一些留下来的光。", sub: "愿每一次记录，都比上一次更接近真实。" },
];

function defaultSiteConfig() { return { author: "louis16s", since: "2020", footerQuotes: DEFAULT_FOOTER_QUOTES }; }

function toPublicSiteConfig(pages: any[]) {
  const config = defaultSiteConfig();
  for (const page of pages) {
    const properties = page.properties || {};
    if (properties["启用"]?.checkbox !== true) continue;
    const key = title(properties["配置名"]).replaceAll("`", "").trim().toLocaleUpperCase();
    const value = plain(properties["配置值"]).trim();
    if (key === "AUTHOR" && value) config.author = value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80) || config.author;
    if (key === "SINCE") config.since = value.match(/(?:19|20)\d{2}/)?.[0] || config.since;
    if (key === "FOOTER_QUOTES" && value) {
      const quotes = value.split(/\r?\n/)
        .map((line) => line.split(/\s*[｜|]\s*/, 2).map((part) => part.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim()))
        .filter((parts) => parts.length === 2 && parts[0] && parts[1])
        .slice(0, 16)
        .map(([lead, sub]) => ({ lead: lead.slice(0, 100), sub: sub.slice(0, 120) }));
      if (quotes.length) config.footerQuotes = quotes;
    }
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
      const normalizedType = type === "link_preview" ? "bookmark" : type;
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
