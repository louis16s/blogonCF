/** Cloudflare Worker entry point with a small Notion content gateway. */
/* eslint-disable @typescript-eslint/no-explicit-any -- Notion block/property unions are normalized at this gateway boundary. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { clearPasswordAttempts, getPasswordAttemptStatus, recordPasswordFailure, type PasswordRateLimitDatabase } from "../db/rate-limit";
import { deleteHeadingJob, readHeadingCache, readHeadingJob, writeHeadingCache, writeHeadingJob, type HeadingIndexJob, type HeadingIndexTask } from "../db/heading-cache";
import { deleteContentIndexPage, hasContentIndex, readContentIndex, readContentIndexVersions, writeContentIndex, type IndexedContentDocument } from "../db/content-index";
import { clearArticlePayload, storeArticlePayload, type ArticlePayload } from "../server/article-context";
import { clearHomePayload, storeHomePayload, type HomePayload } from "../server/home-context";
import { buildWordCloud, normalizeSearchText } from "../shared/wordCloud.js";
import { createDefaultSiteConfig, type SiteConfig } from "../shared/site-config";
import { decodeRouteSegment } from "../shared/url";
import { externalLinkPreview, extractExternalUrls, fetchExternalFeed, isSafeExternalUrl, signPreviewUrl, type ExternalFeed } from "./external-content";
import { CONFIG_IMAGE_KEYS, NOTION_FILE_HOSTS, configPageFileUrl, configPageKey, configPageValue, isConfigLinkPage, toPublicSiteConfig, type NotionConfigPage } from "./site-config";
import { createChildAccessSignature, createMediaAccessSignature, createUnlockCookie, hasUnlockSession, verifyChildAccessSignature, verifyMediaAccessSignature } from "./unlock-session";
import { normalizeNotionCursor, normalizeNotionId, notionFetch, plain, richText, title } from "./notion-client";
import { readNotionPageMetadata } from "./notion-metadata";

interface Env {
  ASSETS?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  DB?: PasswordRateLimitDatabase;
  NOTION_TOKEN?: string;
  NOTION_DATA_SOURCE_ID?: string;
  NOTION_CONFIG_DATA_SOURCE_ID?: string;
  SITE_URL?: string;
  IMAGES?: {
    input(stream: ReadableStream): { transform(options: Record<string, unknown>): { output(options: { format: string; quality: number }): Promise<{ response(): Response }> } };
  };
}
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime: number; cron: string; }

const DEFAULT_DATA_SOURCE_ID = "";
const DEFAULT_CONFIG_DATA_SOURCE_ID = "";
const MAX_CONFIG_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_NOTION_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_NOTION_MEDIA_BYTES = 100 * 1024 * 1024;
// Public documents can remain stale for 24 hours. Keep their signed media
// references usable beyond that window; page/owner versions still revoke a
// URL immediately when Notion content changes.
const MEDIA_SIGNATURE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_BLOCKS = 10_000;
const CONTENT_CHUNK_BLOCKS = 300;
const MAX_BLOCK_DEPTH = 12;
const MAX_INDEX_BLOCKS_PER_POST = 800;
const MAX_INDEX_CHARS_PER_POST = 120_000;
const WORD_CLOUD_CACHE_TTL_MS = 10 * 60 * 1000;
const CONFIG_ROWS_CACHE_TTL_MS = 5 * 60 * 1000;
const SITE_BOOTSTRAP_CACHE_TTL_MS = 5 * 60 * 1000;
const SITE_BOOTSTRAP_STALE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RSS_FEEDS = 8;
const LEGACY_EMOJI_PATTERN = /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)$/u;
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" };
const publicContentHeaders = { ...jsonHeaders, "cache-control": "public, max-age=300, stale-while-revalidate=86400" };
const edgeBootstrapHeaders = { ...jsonHeaders, "cache-control": "public, max-age=300, stale-while-revalidate=86400" };
const wordCloudCache = new Map<string, { expiresAt: number; payload: WordCloudPayload }>();
const publicCorpusCache = new Map<string, { expiresAt: number; corpus?: PublicCorpus; pending?: Promise<PublicCorpus> }>();
const siteBootstrapCache = new Map<string, { freshUntil: number; staleUntil: number; payload?: HomePayload; pending?: Promise<HomePayload> }>();
const headingIndexCache = new Map<string, { expiresAt: number; headings?: HeadingSummary[]; pending?: Promise<HeadingSummary[]> }>();
const headingJobCache = new Map<string, HeadingIndexJob>();
const contentSourceCache = new Map<string, { expiresAt: number; id: string }>();
const configRowsCache = new Map<string, { expiresAt: number; rows?: NotionConfigPage[]; pending?: Promise<NotionConfigPage[]> }>();
const expensiveRequestWindows = new Map<string, { startedAt: number; count: number }>();

type WordCloudPayload = { words: ReturnType<typeof buildWordCloud>; sourceCount: number; partial: boolean; source: "d1" | "notion" };
type SearchDocument = ReturnType<typeof toPost> & { body: string; searchBody: string };
type PublicCorpus = { documents: SearchDocument[]; partial: boolean; source: "d1" | "notion" };
type WorkerCacheStorage = CacheStorage & { default?: Cache };
type HeadingSummary = { id: string; label: string; level: number };
type SiteConfigPayload = SiteConfig;

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    env ||= {};
    const url = new URL(request.url);
    const allowedMethods = allowedMethodsForPath(url.pathname);
    if (allowedMethods && !allowedMethods.includes(request.method)) {
      return Response.json({ error: "Method not allowed" }, {
        status: 405,
        headers: { ...jsonHeaders, allow: allowedMethods.join(", "), "cache-control": "no-store" },
      });
    }
    if (url.pathname === "/sitemap.xml" && (request.method === "GET" || request.method === "HEAD")) return withHead(request, await cachedPublicDocument(request, env, ctx, () => notionSitemap(env, url)));
    if (url.pathname === "/rss.xml" && (request.method === "GET" || request.method === "HEAD")) return withHead(request, await cachedPublicDocument(request, env, ctx, () => notionRss(env, url)));
    if (url.pathname === "/favicon.ico" && (request.method === "GET" || request.method === "HEAD")) {
      if (!env.ASSETS && !env.NOTION_TOKEN) return withHead(request, await handler.fetch(requestWithSiteOrigin(request, env), env, ctx));
      return withHead(request, await cachedConfigAsset(request, env, ctx, () => notionSiteIcon(env, request)));
    }
    if (url.pathname.startsWith("/_notion/config-image/") && (request.method === "GET" || request.method === "HEAD")) return withHead(request, await cachedConfigAsset(request, env, ctx, () => notionConfigImage(env, url)));
    if (url.pathname === "/api/content/posts" && (request.method === "GET" || request.method === "HEAD")) return withHead(request, await notionPosts(env, request, ctx));
    if (url.pathname === "/api/content/navigation" && request.method === "GET") {
      return cachedPublicApi(request, env, ctx, "navigation", 300, () => notionNavigation(env));
    }
    if (url.pathname === "/api/content/config" && request.method === "GET") {
      return cachedPublicApi(request, env, ctx, "config", 300, () => notionSiteConfig(env));
    }
    if (url.pathname === "/api/content/search" && request.method === "GET") {
      return cachedPublicApi(request, env, ctx, "search", 120, async () => {
        const limited = checkExpensiveRequest(request, "search", 20, 60_000);
        return limited || notionSearch(env, url, ctx);
      });
    }
    if (url.pathname === "/api/content/rss-feeds" && request.method === "GET") {
      return cachedPublicApi(request, env, ctx, `rss-feeds:${url.searchParams.get("slug") || ""}`, 300, () => notionExternalRss(env, url));
    }
    if (url.pathname === "/api/content/link-preview" && request.method === "GET") return externalLinkPreview(url, request, env.NOTION_TOKEN, env.DB);
    if (url.pathname === "/api/content/word-cloud" && request.method === "GET") {
      return cachedPublicApi(request, env, ctx, "word-cloud", 900, async () => {
        const limited = checkExpensiveRequest(request, "word-cloud", 2, 10 * 60_000);
        return limited || notionWordCloud(env, ctx);
      });
    }
    if (url.pathname === "/api/content/unlock-session" && request.method === "GET") return notionUnlockSession(env, request, url);
    if (url.pathname === "/api/content/child" && request.method === "POST") return notionChildPage(env, request);
    if (url.pathname === "/api/content/page-child" && request.method === "POST") return notionSitePageChild(env, request);
    if (url.pathname === "/api/content/database" && request.method === "POST") return notionChildDatabase(env, request);
    if (["/_notion/image", "/_notion/media"].includes(url.pathname) && (request.method === "GET" || request.method === "HEAD")) return notionMedia(request, env);
    if (url.pathname.startsWith("/api/content/post/") && (request.method === "GET" || request.method === "POST")) {
      const slug = decodeRouteSegment(url.pathname.slice("/api/content/post/".length));
      return request.method === "GET"
        ? cachedPublicContent(request, env, ctx, "post", slug, () => notionPost(env, slug, request))
        : notionPost(env, slug, request);
    }
    if (url.pathname.startsWith("/api/content/page/") && request.method === "GET") {
      const slug = decodeRouteSegment(url.pathname.slice("/api/content/page/".length));
      return cachedPublicContent(request, env, ctx, "page", slug, () => notionSitePage(env, slug, request));
    }
    if (url.pathname === "/api/health" && (request.method === "GET" || request.method === "HEAD")) {
      return withHead(request, Response.json({ ok: true, notionConfigured: Boolean(env.NOTION_TOKEN) }, { headers: { ...jsonHeaders, "cache-control": "no-store" } }));
    }

    if (url.pathname === "/_vinext/image") {
      if (!env.ASSETS) return error(503, "Image optimization is unavailable");
      const assets = env.ASSETS;
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => assets.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          if (!env.IMAGES) return new Response(body);
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }
    if (request.method === "GET" && url.pathname.startsWith("/blog/")) {
      const slug = renderRouteSlug(url.pathname.slice("/blog/".length));
      const payload = await articlePayloadForRender(env, slug, request, ctx);
      const key = storeArticlePayload(payload);
      const headers = new Headers(request.headers);
      headers.set("x-blog-article-context", key);
      setSiteOriginHeader(headers, env, url);
      setSiteConfigHeader(headers, payload.config);
      try {
        const rendered = await handler.fetch(new Request(request, { headers }), env, ctx);
        const status = payload.status && payload.status >= 400 && rendered.status < 400 ? payload.status : rendered.status;
        const responseHeaders = new Headers(rendered.headers);
        responseHeaders.set("cache-control", renderedCacheControl(request, payload.status, Boolean(payload.post?.locked)));
        return secureDocumentResponse(new Response(rendered.body, { status, headers: responseHeaders }));
      }
      finally { clearArticlePayload(key); }
    }
    if (request.method === "GET" && (url.pathname === "/about" || url.pathname.startsWith("/page/"))) {
      const slug = url.pathname === "/about" ? "about" : renderRouteSlug(url.pathname.slice("/page/".length));
      const payload = await sitePagePayloadForRender(env, slug, request, ctx);
      const key = storeArticlePayload(payload);
      const headers = new Headers(request.headers);
      headers.set("x-blog-article-context", key);
      setSiteOriginHeader(headers, env, url);
      setSiteConfigHeader(headers, payload.config);
      try {
        const rendered = await handler.fetch(new Request(request, { headers }), env, ctx);
        const status = payload.status && payload.status >= 400 && rendered.status < 400 ? payload.status : rendered.status;
        const responseHeaders = new Headers(rendered.headers);
        responseHeaders.set("cache-control", renderedCacheControl(request, payload.status));
        return secureDocumentResponse(new Response(rendered.body, { status, headers: responseHeaders }));
      }
      finally { clearArticlePayload(key); }
    }
    if (request.method === "GET" && url.pathname === "/") {
      const payload = await homePayloadForRender(env, request, ctx);
      const key = storeHomePayload(payload);
      const headers = new Headers(request.headers);
      headers.set("x-blog-home-context", key);
      setSiteOriginHeader(headers, env, url);
      setSiteConfigHeader(headers, payload.config);
      try {
        const rendered = await handler.fetch(new Request(request, { headers }), env, ctx);
        const status = payload.status && payload.status >= 400 && rendered.status < 400 ? payload.status : rendered.status;
        const responseHeaders = new Headers(rendered.headers);
        responseHeaders.set("cache-control", renderedCacheControl(request, payload.status));
        return secureDocumentResponse(new Response(rendered.body, { status, headers: responseHeaders }));
      }
      finally { clearHomePayload(key); }
    }
    return secureDocumentResponse(await handler.fetch(requestWithSiteOrigin(request, env), env, ctx));
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refreshContentIndex(env));
    ctx.waitUntil(refreshExternalFeeds(env));
  },
};

async function contentIndexSourceKey(env: Env): Promise<string> {
  const resolvedSourceId = await resolveContentDataSourceId(env);
  return `${resolvedSourceId}:${env.NOTION_CONFIG_DATA_SOURCE_ID || DEFAULT_CONFIG_DATA_SOURCE_ID}`;
}

function renderedCacheControl(request: Request, status?: number, privateContent = false): string {
  // RSC/soft-navigation responses vary by router headers and must never be
  // served as the cached HTML document for another request.
  if (isClientNavigationRequest(request) || (status && status >= 400)) return "no-store";
  if (privateContent) return "private, no-store";
  return "public, max-age=300, stale-while-revalidate=86400";
}

function isClientNavigationRequest(request: Request): boolean {
  const accept = request.headers.get("accept") || "";
  return request.headers.has("rsc")
    || request.headers.has("next-router-state-tree")
    || request.headers.has("next-router-prefetch")
    || request.headers.get("purpose") === "prefetch"
    || accept.includes("text/x-component");
}

async function refreshContentIndex(env: Env): Promise<void> {
  if (!env.NOTION_TOKEN || !env.DB) return;
  try {
    const sourceKey = await contentIndexSourceKey(env);
    const pages = await queryPosts(env, undefined, 100);
    const versions = new Map((await readContentIndexVersions(env.DB, sourceKey)).map((row) => [row.page_id, row]));
    const currentIds = new Set<string>();
    for (const page of pages) {
      const pageId = normalizeNotionId(page.id) || page.id;
      currentIds.add(pageId);
      const lastEdited = typeof page.last_edited_time === "string" ? page.last_edited_time : "";
      const locked = Boolean(plain(page.properties?.password));
      const existing = versions.get(pageId);
      if (existing && existing.last_edited_time === lastEdited && Boolean(existing.locked) === locked) continue;
      try {
        const document = await buildIndexedDocument(env, page);
        await writeContentIndex(env.DB, sourceKey, pageId, lastEdited, document);
      } catch (reason) {
        console.warn(JSON.stringify({ event: "content-index-page-failed", pageId, message: reason instanceof Error ? reason.message : String(reason) }));
      }
    }
    for (const pageId of versions.keys()) if (!currentIds.has(pageId)) await deleteContentIndexPage(env.DB, pageId);
  } catch (reason) {
    console.warn(reason instanceof Error ? reason.message : "Content index refresh failed");
  }
}

async function buildIndexedDocument(env: Env, page: any): Promise<IndexedContentDocument> {
  const post = toPost(page);
  const locked = Boolean(post.locked);
  if (locked) return { ...post, body: "", searchBody: "", partial: false };
  const state = { remaining: MAX_INDEX_BLOCKS_PER_POST, truncated: false };
  const blocks = await getBlockChildren(env, page.id, state, 0);
  return { ...post, body: blockText(blocks), searchBody: blockText(blocks, true), partial: state.truncated };
}

async function refreshExternalFeeds(env: Env): Promise<void> {
  if (!env.NOTION_TOKEN) return;
  const config = await queryPublicSiteConfig(env).catch(() => createDefaultSiteConfig());
  if (!config.rssEnabled) return;
  const pages = await querySitePages(env, undefined, 100);
  const candidates = pages.filter((page) => /资讯|news|links/i.test(`${plain(page.properties?.slug)} ${title(page.properties?.title)}`));
  for (const page of candidates.slice(0, 4)) {
    try {
      const state = newBlockReadState();
      const urls = extractExternalUrls(await getBlockChildren(env, page.id, state, 0)).slice(0, MAX_RSS_FEEDS);
      await mapWithConcurrency(urls, 2, (feedUrl) => fetchExternalFeed(feedUrl, env.DB));
    } catch (reason) {
      console.warn(JSON.stringify({ event: "external-feed-page-failed", pageId: page.id, message: reason instanceof Error ? reason.message : String(reason) }));
    }
  }
}

async function notionSiteIcon(env: Env, request: Request): Promise<Response> {
  if (!env.NOTION_TOKEN) return fetchStaticAsset(env, "/favicon.svg", request.url);
  try {
    const rows = await queryConfigRows(env);
    const fileResponse = await notionConfigImageByKey(env, "FAVICON_URL", rows);
    if (fileResponse?.ok) return fileResponse;
    const config = toPublicSiteConfig(rows);
    if (!config.favicon || config.favicon === "/favicon.svg") return fetchStaticAsset(env, "/favicon.svg", request.url);
    const target = new URL(config.favicon, request.url);
    if (target.origin === new URL(request.url).origin) return fetchStaticAsset(env, `${target.pathname}${target.search}`, request.url);
    return new Response(null, { status: 302, headers: { location: target.href, "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" } });
  } catch { return fetchStaticAsset(env, "/favicon.svg", request.url); }
}

function fetchStaticAsset(env: Env, path: string, requestUrl: string): Promise<Response> {
  const request = new Request(new URL(path, requestUrl));
  return env.ASSETS ? env.ASSETS.fetch(request) : fetch(request);
}

async function notionConfigImage(env: Env, requestUrl: URL): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  const key = decodeRouteSegment(requestUrl.pathname.slice("/_notion/config-image/".length)).toLocaleUpperCase();
  if (!CONFIG_IMAGE_KEYS.has(key)) return error(404, "Config image not found");
  try {
    return await notionConfigImageByKey(env, key) || error(404, "Config image not found");
  } catch (reason) { return notionError(reason); }
}

async function notionConfigImageByKey(env: Env, key: string, rows?: NotionConfigPage[]): Promise<Response | null> {
  const page = (rows || await queryConfigRows(env)).find((row) => row.properties?.["启用"]?.checkbox === true && configPageKey(row) === key);
  const rawUrl = configPageFileUrl(page);
  if (!rawUrl) return null;
  let source: URL;
  try { source = new URL(rawUrl); }
  catch { return null; }
  if (source.protocol !== "https:" || !NOTION_FILE_HOSTS.has(source.hostname)) return null;
  let response: Response;
  try {
    response = await fetch(source, { redirect: "manual", signal: AbortSignal.timeout(8_000) });
  } catch {
    return null;
  }
  if (!response.ok || !response.body) return response.status >= 500 ? null : error(response.status || 502, "Config image is temporarily unavailable");
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].toLocaleLowerCase() || "";
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (!contentType.startsWith("image/")) return error(415, "Unsupported config image response");
  if (Number.isFinite(contentLength) && contentLength > MAX_CONFIG_IMAGE_BYTES) {
    await response.body.cancel();
    return error(413, "Config image is too large");
  }
  const bytes = await readLimitedBytes(response.body, MAX_CONFIG_IMAGE_BYTES);
  if (!bytes) return error(413, "Config image is too large");
  return new Response(bytes, { headers: {
    "content-type": contentType,
    "cache-control": "public, max-age=300, stale-while-revalidate=86400",
    "x-content-type-options": "nosniff",
  } });
}

async function readLimitedBytes(body: ReadableStream<Uint8Array>, limit: number): Promise<ArrayBuffer | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel("response exceeds configured limit");
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer as ArrayBuffer;
}

async function blockBelongsToPage(env: Env, block: any, ownerPageId: string): Promise<boolean> {
  let parent = block?.parent;
  for (let depth = 0; depth < 24; depth++) {
    const pageParentId = normalizeNotionId(parent?.page_id);
    if (pageParentId) return pageParentId === ownerPageId;
    const blockParentId = normalizeNotionId(parent?.block_id);
    if (!blockParentId) return false;
    const parentBlock = await notionFetch(env, `/blocks/${blockParentId}`);
    if (parentBlock?.archived || parentBlock?.in_trash) return false;
    parent = parentBlock.parent;
  }
  return false;
}

function isPublishedContentPage(page: any): boolean {
  const type = page?.properties?.type?.select?.name;
  const status = page?.properties?.status?.select?.name;
  return ["Post", "Page"].includes(type) && status === "Published";
}

function notionMediaValue(block: any): any {
  const value = block?.[block?.type] || {};
  return value.type === "external" ? value.external : value.file;
}

function validMediaContentType(type: string, contentType: string): boolean {
  if (type === "image") return contentType.startsWith("image/");
  if (type === "video") return contentType.startsWith("video/");
  if (type === "audio") return contentType.startsWith("audio/");
  if (type === "pdf") return contentType === "application/pdf";
  return type === "file" && Boolean(contentType) && !/^(?:text\/html|application\/(?:xhtml\+xml|javascript))$/.test(contentType);
}

function limitMediaStream(body: ReadableStream<Uint8Array>, maximumBytes: number): ReadableStream<Uint8Array> {
  let received = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maximumBytes) controller.error(new Error("Media stream exceeded the configured size limit"));
      else controller.enqueue(chunk);
    },
  }));
}

async function notionMedia(request: Request, env: Env): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  const requestUrl = new URL(request.url);
  const blockId = normalizeNotionId(requestUrl.searchParams.get("id"));
  const rootPageId = normalizeNotionId(requestUrl.searchParams.get("root"));
  const ownerPageId = normalizeNotionId(requestUrl.searchParams.get("owner"));
  const rootVersion = requestUrl.searchParams.get("rootVersion") || "";
  const ownerVersion = requestUrl.searchParams.get("ownerVersion") || "";
  const expiresAt = Number(requestUrl.searchParams.get("expires"));
  const privateSlug = requestUrl.searchParams.get("private") || "";
  const suppliedSignature = requestUrl.searchParams.get("signature") || "";
  if (!blockId || !rootPageId || !ownerPageId || privateSlug.length > 180 || rootVersion.length > 80 || ownerVersion.length > 80) return error(400, "Invalid media request");
  if (!await verifyMediaAccessSignature(env.NOTION_TOKEN, rootPageId, ownerPageId, blockId, rootVersion, ownerVersion, expiresAt, privateSlug, suppliedSignature)) return error(403, "Media URL is not authorized");
  if (privateSlug && !await hasUnlockSession(request, env.NOTION_TOKEN, privateSlug)) return error(403, "请先解锁父文章");
  try {
    const [rootPage, ownerPage, block] = await Promise.all([
      notionFetch(env, `/pages/${rootPageId}`),
      ownerPageId === rootPageId ? Promise.resolve(null) : notionFetch(env, `/pages/${ownerPageId}`),
      notionFetch(env, `/blocks/${blockId}`),
    ]);
    const resolvedOwner = ownerPage || rootPage;
    if (rootPage?.object !== "page" || rootPage.archived || rootPage.in_trash || rootPage.last_edited_time !== rootVersion) return error(404, "Media parent is no longer available");
    if (!isPublishedContentPage(rootPage)) return error(403, "Media parent is not published");
    if (privateSlug) {
      if (plain(rootPage.properties?.slug) !== privateSlug || !plain(rootPage.properties?.password)) return error(403, "Media parent does not match the unlock session");
    } else if (plain(rootPage.properties?.password)) return error(403, "Media parent requires an unlock session");
    if (resolvedOwner?.object !== "page" || resolvedOwner.archived || resolvedOwner.in_trash || resolvedOwner.last_edited_time !== ownerVersion) return error(404, "Media owner is no longer available");
    if (ownerPageId !== rootPageId) {
      const descendant = await descendantPage(env, ownerPageId, rootPageId);
      if (!descendant && !isPublishedContentPage(resolvedOwner)) return error(403, "Media owner is not authorized");
    }
    if (block?.object !== "block" || block.archived || block.in_trash || !["image", "video", "audio", "pdf", "file"].includes(block.type)) return error(404, "Media block not found");
    if (!await blockBelongsToPage(env, block, ownerPageId)) return error(403, "Media block is no longer attached to this page");
    const rawUrl = notionMediaValue(block)?.url;
    const sourceValue = safeResourceUrl(rawUrl, true);
    if (!sourceValue) return error(404, "Media source not found");
    const source = new URL(sourceValue);
    if (!NOTION_FILE_HOSTS.has(source.hostname)) return error(400, "Media host is not allowed");
    const upstreamHeaders = new Headers();
    const range = request.headers.get("range");
    if (range && /^bytes=\d*-\d*(?:,\d*-\d*)*$/.test(range)) upstreamHeaders.set("range", range);
    const response = await fetch(source, { method: request.method, headers: upstreamHeaders, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (!response.ok || (request.method === "GET" && !response.body)) return error(response.status || 502, "Media is temporarily unavailable");
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].toLocaleLowerCase();
    if (!contentType || !validMediaContentType(block.type, contentType)) return error(415, "Unsupported media response");
    const contentLength = Number(response.headers.get("content-length") || 0);
    const maximumBytes = block.type === "image" ? MAX_NOTION_IMAGE_BYTES : MAX_NOTION_MEDIA_BYTES;
    if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
      await response.body?.cancel();
      return error(413, "Media is too large");
    }
    let output = response.body
      ? new Response(limitMediaStream(response.body, maximumBytes), { status: response.status, statusText: response.statusText, headers: response.headers })
      : response;
    if (block.type === "image" && /image\/(?:hei[cf])|\.(?:heic|heif)(?:$|\?)/i.test(`${contentType} ${source.pathname}`) && env.IMAGES && request.method === "GET" && response.body && !range) {
      try {
        output = await (await env.IMAGES.input(output.body!).transform({}).output({ format: "image/jpeg", quality: 84 })).response();
      } catch (reason) {
        console.warn(reason instanceof Error ? reason.message : "HEIC conversion failed");
        return error(502, "Media conversion is temporarily unavailable");
      }
    }
    const headers = new Headers(output.headers);
    headers.set("cache-control", privateSlug
      ? "private, no-store"
      : "public, max-age=300, stale-while-revalidate=86400");
    headers.set("x-content-type-options", "nosniff");
    if (block.type === "file") {
      const filename = decodeURIComponent(source.pathname.split("/").pop() || "attachment").replace(/[\r\n"\\]/g, "_").slice(0, 160) || "attachment";
      headers.set("content-disposition", `attachment; filename="${filename}"`);
    }
    headers.delete("set-cookie");
    return request.method === "HEAD" ? new Response(null, { status: output.status, headers }) : new Response(output.body, { status: output.status, headers });
  } catch (reason) {
    console.error(reason instanceof Error ? reason.message : "Notion media fetch failed");
    return error(502, "Media is temporarily unavailable");
  }
}

async function articlePayloadForRender(env: Env, slug: string, request: Request, ctx: ExecutionContext): Promise<ArticlePayload> {
  const [response, config] = await Promise.all([
    cachedPublicContent(request, env, ctx, "post", slug, () => notionPost(env, slug, new Request(request.url, { headers: request.headers }))),
    queryPublicSiteConfig(env).catch(() => createDefaultSiteConfig()),
  ]);
  const payload = await response.json().catch(() => ({ error: "文章暂时无法读取" })) as ArticlePayload;
  return { ...payload, config, status: response.status };
}

async function sitePagePayloadForRender(env: Env, slug: string, request: Request, ctx: ExecutionContext): Promise<ArticlePayload> {
  const [response, config] = await Promise.all([
    cachedPublicContent(request, env, ctx, "page", slug, () => notionSitePage(env, slug, new Request(`https://internal.invalid/api/content/page/${encodeURIComponent(slug)}`))),
    queryPublicSiteConfig(env).catch(() => createDefaultSiteConfig()),
  ]);
  const payload = await response.json().catch(() => ({ error: "页面暂时无法读取" })) as ArticlePayload;
  return { ...payload, config, status: response.status };
}

async function siteBootstrapCacheKey(env: Env): Promise<string> {
  const rows = await queryConfigRows(env).catch(() => []);
  return `${configuredContentDataSourceId(env, rows)}:${env.NOTION_CONFIG_DATA_SOURCE_ID || DEFAULT_CONFIG_DATA_SOURCE_ID}`;
}

async function querySiteBootstrap(env: Env): Promise<HomePayload> {
  const configRows = await queryConfigRows(env).catch(() => []);
  const sourceId = configuredContentDataSourceId(env, configRows);
  const [pages, contentPages] = await Promise.all([
    queryPosts(env, undefined, 100, sourceId),
    querySiteLinks(env, sourceId),
  ]);
  const noticePage = contentPages.find((page) => page.properties?.type?.select?.name === "Notice");
  const config = toPublicSiteConfig(configRows);
  const configLinkPages = configRows.filter(isConfigLinkPage);
  return {
    posts: pages.map(toPost).filter((post) => post.slug),
    links: toSiteLinks([...contentPages, ...configLinkPages]).filter((link) => config.rssEnabled || link.kind !== "rss"),
    notice: noticePage ? toSiteNotice(noticePage) : undefined,
    config,
    notionConfigured: true,
  };
}

async function getSiteBootstrap(env: Env): Promise<HomePayload> {
  if (!env.NOTION_TOKEN) throw new Error("Notion connection is not configured");
  const key = await siteBootstrapCacheKey(env);
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

async function cachedPublicDocument(request: Request, env: Env, ctx: ExecutionContext, load: () => Promise<Response>): Promise<Response> {
  const cache = defaultWorkerCache();
  const keyUrl = new URL(request.url);
  const canonical = publicSiteOrigin(env, keyUrl);
  keyUrl.protocol = canonical.protocol;
  keyUrl.host = canonical.host;
  keyUrl.search = "";
  keyUrl.searchParams.set("schema", "5");
  const resolvedDataSourceId = env.NOTION_TOKEN
    ? await resolveContentDataSourceId(env).catch(() => env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID)
    : env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID;
  keyUrl.searchParams.set("data", resolvedDataSourceId);
  keyUrl.searchParams.set("config", env.NOTION_CONFIG_DATA_SOURCE_ID || DEFAULT_CONFIG_DATA_SOURCE_ID);
  const key = new Request(keyUrl.toString(), { method: "GET" });
  const cached = await cache?.match(key);
  if (cached) return cached;

  const response = await load();
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", "public, max-age=300, stale-while-revalidate=86400");
  const cacheable = new Response(response.body, { status: response.status, headers });
  if (cache) ctx.waitUntil(cache.put(key, cacheable.clone()));
  return cacheable;
}

async function cachedPublicApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  namespace: string,
  maxAgeSeconds: number,
  load: () => Promise<Response>,
): Promise<Response> {
  const cache = defaultWorkerCache();
  // Keep unit tests and local Miniflare behavior identical when Cache API is
  // unavailable; production Workers have the default cache binding enabled.
  if (!cache) return load();

  const keyUrl = new URL(request.url);
  const canonical = publicSiteOrigin(env, keyUrl);
  keyUrl.protocol = canonical.protocol;
  keyUrl.host = canonical.host;
  const sortedParams = [...keyUrl.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  keyUrl.search = new URLSearchParams(sortedParams).toString();
  keyUrl.searchParams.set("schema", "1");
  keyUrl.searchParams.set("cache", namespace);
  const resolvedDataSourceId = env.NOTION_TOKEN
    ? await resolveContentDataSourceId(env).catch(() => env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID)
    : env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID;
  keyUrl.searchParams.set("data", resolvedDataSourceId);
  keyUrl.searchParams.set("config", env.NOTION_CONFIG_DATA_SOURCE_ID || DEFAULT_CONFIG_DATA_SOURCE_ID);
  const key = new Request(keyUrl.toString(), { method: "GET" });
  const cached = await cache.match(key).catch(() => undefined);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-blog-cache", "hit");
    return new Response(cached.body, { status: cached.status, headers });
  }

  const response = await load();
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", `public, max-age=${maxAgeSeconds}, stale-while-revalidate=86400`);
  headers.set("x-blog-cache", "miss");
  const cacheable = new Response(response.body, { status: response.status, headers });
  ctx.waitUntil(cache.put(key, cacheable.clone()).catch((reason) => {
    console.warn(reason instanceof Error ? reason.message : "Public API cache write failed");
  }));
  return cacheable;
}

async function cachedPublicContent(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  kind: "post" | "page",
  slug: string,
  load: () => Promise<Response>,
): Promise<Response> {
  const cache = defaultWorkerCache();
  if (!cache || request.method !== "GET") return load();
  const requestUrl = new URL(request.url);
  const canonical = publicSiteOrigin(env, requestUrl);
  const keyUrl = new URL(`/__blog-cache/content/${kind}/${encodeURIComponent(slug)}`, canonical);
  const cursor = normalizeNotionCursor(requestUrl.searchParams.get("cursor"));
  if (cursor) keyUrl.searchParams.set("cursor", cursor);
  keyUrl.searchParams.set("schema", "2");
  const resolvedDataSourceId = env.NOTION_TOKEN
    ? await resolveContentDataSourceId(env).catch(() => env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID)
    : env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID;
  keyUrl.searchParams.set("data", resolvedDataSourceId);
  keyUrl.searchParams.set("config", env.NOTION_CONFIG_DATA_SOURCE_ID || DEFAULT_CONFIG_DATA_SOURCE_ID);
  const key = new Request(keyUrl, { method: "GET" });
  const cached = await cache.match(key).catch(() => undefined);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-blog-cache", "hit");
    return new Response(cached.body, { status: cached.status, headers });
  }

  const response = await load();
  if (!response.ok) return response;
  const payload = await response.clone().json().catch(() => null) as ArticlePayload | null;
  // An unlocked private response still carries post.locked=true. Neither it
  // nor the locked gate may ever enter a shared cache.
  if (!payload || payload.locked !== false || payload.post?.locked) return response;
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  headers.set("cache-control", "public, max-age=300, stale-while-revalidate=86400");
  headers.set("x-blog-cache", "miss");
  const cacheable = new Response(response.body, { status: response.status, headers });
  ctx.waitUntil(cache.put(key, cacheable.clone()).catch((reason) => {
    console.warn(reason instanceof Error ? reason.message : "Public content cache write failed");
  }));
  return cacheable;
}

async function cachedConfigAsset(request: Request, env: Env, ctx: ExecutionContext, load: () => Promise<Response>): Promise<Response> {
  const cache = defaultWorkerCache();
  const keyUrl = new URL(request.url);
  const revision = keyUrl.searchParams.get("v") || "";
  keyUrl.search = "";
  keyUrl.searchParams.set("schema", "1");
  keyUrl.searchParams.set("config", env.NOTION_CONFIG_DATA_SOURCE_ID || DEFAULT_CONFIG_DATA_SOURCE_ID);
  if (/^[a-z0-9]{1,16}$/i.test(revision)) keyUrl.searchParams.set("v", revision);
  const key = new Request(keyUrl.toString(), { method: "GET" });
  const cached = await cache?.match(key).catch(() => undefined);
  if (cached) return cached;

  const response = await load();
  if (cache && response.ok && response.headers.get("content-type")?.toLocaleLowerCase().startsWith("image/")) {
    ctx.waitUntil(cache.put(key, response.clone()).catch(() => undefined));
  }
  return response;
}

async function siteBootstrapEdgeKey(env: Env, request: Request): Promise<Request> {
  const url = new URL(request.url);
  url.protocol = "https:";
  const canonical = publicSiteOrigin(env, url);
  url.host = canonical.host;
  url.pathname = "/__blog-cache/site-bootstrap";
  url.search = "";
  url.searchParams.set("schema", "6");
  const resolvedDataSourceId = env.NOTION_TOKEN
    ? await resolveContentDataSourceId(env).catch(() => env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID)
    : env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID;
  url.searchParams.set("data", resolvedDataSourceId);
  url.searchParams.set("config", env.NOTION_CONFIG_DATA_SOURCE_ID || DEFAULT_CONFIG_DATA_SOURCE_ID);
  return new Request(url.toString(), { method: "GET" });
}

async function homePayloadForRender(env: Env, request: Request, ctx: ExecutionContext): Promise<HomePayload> {
  if (!env.NOTION_TOKEN) return { posts: [], links: [], config: createDefaultSiteConfig(), notionConfigured: false };
  const endpoint = new URL("/api/content/posts", request.url);
  const response = await notionPosts(env, new Request(endpoint, { headers: request.headers }), ctx);
  if (!response.ok) return { posts: [], links: [], config: createDefaultSiteConfig(), status: response.status, notionConfigured: true };
  const payload = await response.json().catch(() => ({})) as Partial<HomePayload>;
  return {
    posts: Array.isArray(payload.posts) ? payload.posts : [],
    links: Array.isArray(payload.links) ? payload.links : [],
    notice: payload.notice?.id && payload.notice?.title ? payload.notice : undefined,
    config: payload.config?.author && payload.config?.since ? payload.config : createDefaultSiteConfig(),
    notionConfigured: payload.notionConfigured !== false,
  };
}

async function notionPosts(env: Env, request?: Request, ctx?: ExecutionContext): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  try {
    const cache = request ? defaultWorkerCache() : undefined;
    const cacheKey = request && cache ? await siteBootstrapEdgeKey(env, request) : undefined;
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
    const [linkPages, configRows] = await Promise.all([querySiteLinks(env), queryConfigRows(env).catch(() => [])]);
    const config = toPublicSiteConfig(configRows);
    const links = toSiteLinks([...linkPages, ...configRows.filter(isConfigLinkPage)]).filter((link) => config.rssEnabled || link.kind !== "rss");
    return Response.json({ links, source: "notion" }, { headers: publicContentHeaders });
  } catch (reason) { return notionError(reason); }
}

async function notionWordCloud(env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  const config = await queryPublicSiteConfig(env).catch(() => createDefaultSiteConfig());
  if (!config.wordCloudEnabled) return error(404, "Word cloud is disabled");
  const cacheKey = await contentIndexSourceKey(env);
  const cached = wordCloudCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json(cached.payload, { headers: { ...jsonHeaders, "cache-control": "public, max-age=900, stale-while-revalidate=86400" } });
  }

  try {
    const corpus = await getPublicCorpus(env, ctx);
    const payload: WordCloudPayload = {
      words: buildWordCloud(corpus.documents.map(({ id, title, body }) => ({ id, title, body }))),
      sourceCount: corpus.documents.length,
      partial: corpus.partial,
      source: corpus.source,
    };
    setBoundedMap(wordCloudCache, cacheKey, { expiresAt: Date.now() + WORD_CLOUD_CACHE_TTL_MS, payload }, 8);
    return Response.json(payload, { headers: { ...jsonHeaders, "cache-control": "public, max-age=900, stale-while-revalidate=86400" } });
  } catch (reason) { return notionError(reason); }
}

async function notionSearch(env: Env, url: URL, ctx?: ExecutionContext): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  const config = await queryPublicSiteConfig(env).catch(() => createDefaultSiteConfig());
  if (!config.searchEnabled) return error(404, "Search is disabled");
  const query = normalizeSearchText(url.searchParams.get("q") || "");
  const warming = url.searchParams.get("warm") === "1";
  if (!query && !warming) return Response.json({ matches: [], partial: false, source: "index" }, { headers: { ...jsonHeaders, "cache-control": "public, max-age=60" } });
  if (query.length > 100) return error(400, "Search query is too long");
  try {
    const corpus = await getPublicCorpus(env, ctx);
    if (warming) return Response.json({ matches: [], warmed: true, partial: corpus.partial, source: corpus.source }, { headers: { ...jsonHeaders, "cache-control": "public, max-age=60" } });
    const matches = corpus.documents
      .filter((document) => normalizeSearchText([
        document.title,
        document.summary,
        document.category,
        ...document.tags,
        document.searchBody,
      ].join("\n")).includes(query))
      .map((document) => document.id);
    return Response.json({ matches, partial: corpus.partial, source: corpus.source }, { headers: { ...jsonHeaders, "cache-control": "public, max-age=120, stale-while-revalidate=600" } });
  } catch (reason) { return notionError(reason); }
}

async function notionExternalRss(env: Env, url: URL): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  const config = await queryPublicSiteConfig(env).catch(() => createDefaultSiteConfig());
  if (!config.rssEnabled) return error(404, "RSS is disabled");
  const slug = url.searchParams.get("slug") || "";
  if (!slug || slug.length > 180) return error(400, "Invalid page slug");
  try {
    const page = await findSitePage(env, slug);
    if (!page) return error(404, "Page not found");
    const state = newBlockReadState();
    const blocks = await getBlockChildren(env, page.id, state, 0);
    const urls = extractExternalUrls(blocks).slice(0, MAX_RSS_FEEDS);
    const feeds = (await mapWithConcurrency(urls, 3, (feedUrl) => fetchExternalFeed(feedUrl, env.DB)))
      .filter((feed): feed is ExternalFeed => Boolean(feed));
    return Response.json({ feeds, partial: state.truncated, source: "notion" }, { headers: edgeBootstrapHeaders });
  } catch (reason) { return notionError(reason); }
}

async function getPublicCorpus(env: Env, ctx?: ExecutionContext): Promise<PublicCorpus> {
  const sourceKey = await contentIndexSourceKey(env);
  const cacheKey = sourceKey;
  const cached = publicCorpusCache.get(cacheKey);
  if (cached?.corpus && cached.expiresAt > Date.now()) return cached.corpus;
  if (cached?.pending) return cached.pending;
  const staleCorpus = cached?.corpus;

  // D1 is the cross-isolate fallback. It contains only public normalized text,
  // so search and word-cloud requests do not need to traverse Notion after the
  // hourly sync (or the first cold rebuild).
  const indexed = await readContentIndex(env.DB, sourceKey);
  if (indexed.length || await hasContentIndex(env.DB, sourceKey)) {
    const corpus = { documents: indexed, partial: indexed.some((document) => document.partial), source: "d1" as const };
    setBoundedMap(publicCorpusCache, cacheKey, { expiresAt: Date.now() + WORD_CLOUD_CACHE_TTL_MS, corpus }, 8);
    return corpus;
  }

  const pending = (async () => {
    const pages = await queryPosts(env, undefined, 100);
    const publicPages = pages.filter((page) => !plain(page.properties?.password));
    let partial = false;
    const indexedDocuments = await mapWithConcurrency(publicPages, 2, async (page) => {
      try {
        const state: BlockReadState = { remaining: MAX_INDEX_BLOCKS_PER_POST, truncated: false };
        const blocks = await getBlockChildren(env, page.id, state, 0);
        if (state.truncated) partial = true;
        return { document: { ...toPost(page), body: blockText(blocks), searchBody: blockText(blocks, true), partial: state.truncated }, lastEditedTime: typeof page.last_edited_time === "string" ? page.last_edited_time : "" };
      } catch (reason) {
        partial = true;
        console.warn(reason instanceof Error ? reason.message : "Public article index read failed");
        return { document: { ...toPost(page), body: "", searchBody: "", partial: true }, lastEditedTime: typeof page.last_edited_time === "string" ? page.last_edited_time : "" };
      }
    });
    const documents = indexedDocuments.map(({ document }) => document);
    const corpus = { documents, partial, source: "notion" as const };
    if (env.DB) {
      const persist = Promise.all(indexedDocuments.map(({ document, lastEditedTime }) => writeContentIndex(
        env.DB,
        sourceKey,
        document.id,
        lastEditedTime,
        document,
      )));
      if (ctx) ctx.waitUntil(persist);
      else await persist;
    }
    setBoundedMap(publicCorpusCache, cacheKey, { expiresAt: Date.now() + WORD_CLOUD_CACHE_TTL_MS, corpus }, 8);
    return corpus;
  })();
  setBoundedMap(publicCorpusCache, cacheKey, { expiresAt: Date.now() + WORD_CLOUD_CACHE_TTL_MS, pending }, 8);
  if (staleCorpus) {
    void pending.catch((reason) => {
      if (publicCorpusCache.get(cacheKey)?.pending === pending) publicCorpusCache.delete(cacheKey);
      console.warn(reason instanceof Error ? reason.message : "Public article index refresh failed");
    });
    return staleCorpus;
  }
  try { return await pending; }
  catch (reason) {
    publicCorpusCache.delete(cacheKey);
    throw reason;
  }
}

async function notionPost(env: Env, slug: string, request: Request): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  if (!slug || slug.length > 180) return error(400, "Invalid article slug");
  const requestedCursor = new URL(request.url).searchParams.get("cursor");
  const cursor = normalizeNotionCursor(requestedCursor);
  if (requestedCursor && !cursor) return error(400, "Invalid content cursor");
  const attemptKey = `${request.headers.get("cf-connecting-ip") || "unknown"}:${slug.toLocaleLowerCase()}`;
  let suppliedPassword = "";
  if (request.method === "POST") {
    const parsed = await readJsonRequest(request, 4 * 1024);
    if ("response" in parsed) return parsed.response;
    suppliedPassword = typeof parsed.body.password === "string" ? parsed.body.password : "";
    if (!suppliedPassword) return error(400, "Password is required");
    if (suppliedPassword.length > 256) return error(400, "Password is too long");
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
      const sessionUnlocked = await hasUnlockSession(request, env.NOTION_TOKEN, slug);
      let supplied = "";
      if (!sessionUnlocked && request.method === "POST") {
        supplied = suppliedPassword;
      }
      if (!sessionUnlocked && supplied !== expectedPassword) {
        if (supplied && env.DB) {
          const failure = await recordPasswordFailure(env.DB, attemptKey);
          if (!failure.allowed) return Response.json({ error: "尝试次数过多，请稍后再试" }, { status: 429, headers: { ...jsonHeaders, "cache-control": "no-store", "retry-after": String(failure.retryAfter) } });
        }
        return Response.json({ post: { ...post, locked: true }, locked: true, error: supplied ? "密码不正确" : undefined }, { status: supplied ? 401 : 200, headers: { ...jsonHeaders, "cache-control": "no-store" } });
      }
      if (env.DB) await clearPasswordAttempts(env.DB, attemptKey);
      const blockState = newBlockReadState();
      const { chunk, headings } = await readArticleChunk(env, page.id, blockState, cursor);
      await Promise.all([
        attachPreviewSignatures(chunk.blocks, env.NOTION_TOKEN),
        attachChildAccessSignatures(chunk.blocks, env, page.id),
        attachMediaAccessSignatures(chunk.blocks, env.NOTION_TOKEN, page, page, slug),
      ]);
      const headers = new Headers({ ...jsonHeaders, "cache-control": "no-store" });
      if (!sessionUnlocked) headers.append("set-cookie", await createUnlockCookie(env.NOTION_TOKEN, slug, request.url));
      return Response.json({ post: { ...post, locked: true }, locked: false, blocks: chunk.blocks, headings, nextCursor: chunk.nextCursor, truncated: blockState.truncated }, { headers });
    }
    const blockState = newBlockReadState();
    const { chunk, headings } = await readArticleChunk(env, page.id, blockState, cursor);
    await Promise.all([
      attachPreviewSignatures(chunk.blocks, env.NOTION_TOKEN),
      attachChildAccessSignatures(chunk.blocks, env, page.id),
      attachMediaAccessSignatures(chunk.blocks, env.NOTION_TOKEN, page, page),
    ]);
    return Response.json({ post: { ...post, locked: Boolean(expectedPassword) }, locked: false, blocks: chunk.blocks, headings, nextCursor: chunk.nextCursor, truncated: blockState.truncated }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
  } catch (reason) { return notionError(reason); }
}

async function notionUnlockSession(env: Env, request: Request, url: URL): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  const slug = url.searchParams.get("slug") || "";
  if (!slug || slug.length > 180) return error(400, "Invalid article slug");
  const unlocked = await hasUnlockSession(request, env.NOTION_TOKEN, slug);
  return Response.json({ unlocked }, {
    status: unlocked ? 200 : 403,
    headers: { ...jsonHeaders, "cache-control": "no-store" },
  });
}

async function notionSitePage(env: Env, slug: string, request: Request): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  if (!slug || slug.length > 180) return error(400, "Invalid page slug");
  const requestedCursor = new URL(request.url).searchParams.get("cursor");
  const cursor = normalizeNotionCursor(requestedCursor);
  if (requestedCursor && !cursor) return error(400, "Invalid content cursor");
  try {
    const page = await findSitePage(env, slug);
    if (!page) return error(404, "Page not found");
    const blockState = newBlockReadState();
    const { chunk, headings } = await readArticleChunk(env, page.id, blockState, cursor);
    await Promise.all([
      attachPreviewSignatures(chunk.blocks, env.NOTION_TOKEN),
      attachChildAccessSignatures(chunk.blocks, env, page.id),
      attachMediaAccessSignatures(chunk.blocks, env.NOTION_TOKEN, page, page),
    ]);
    return Response.json({
      post: toSitePagePost(page),
      locked: false,
      blocks: chunk.blocks,
      headings,
      nextCursor: chunk.nextCursor,
      truncated: blockState.truncated,
    }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
  } catch (reason) { return notionError(reason); }
}

async function notionChildPage(env: Env, request: Request): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  const parsed = await readJsonRequest(request);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body as { slug?: unknown; pageId?: unknown; trail?: unknown; cursor?: unknown; accessSignature?: unknown };
  const slug = typeof body.slug === "string" ? body.slug : "";
  const pageId = normalizeNotionId(body.pageId);
  const trail = Array.isArray(body.trail) ? body.trail.map(normalizeNotionId).filter(Boolean).slice(0, 8) : [];
  const accessSignature = typeof body.accessSignature === "string" ? body.accessSignature : "";
  const cursor = normalizeNotionCursor(body.cursor);
  if (!slug || slug.length > 180 || !pageId || (body.cursor != null && !cursor)) return error(400, "Invalid child page request");

  try {
    const parent = await findPost(env, slug);
    if (!parent) return error(404, "Article not found");
    const expectedPassword = plain(parent.properties?.password);
    if (expectedPassword) {
      if (!await hasUnlockSession(request, env.NOTION_TOKEN, slug)) return error(403, "请先解锁父文章");
    }

    const childPage = await resolveChildPage(env, parent, trail, pageId, accessSignature);
    if (!childPage) return error(404, "没有找到这个子页面，或它已从当前文章移除");
    return childPageResponse(env, childPage, parent, cursor, urlBoolean(new URL(request.url), "headings"), expectedPassword ? slug : "");
  } catch (reason) { return notionError(reason); }
}

async function notionSitePageChild(env: Env, request: Request): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  const parsed = await readJsonRequest(request);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body as { slug?: unknown; pageId?: unknown; trail?: unknown; cursor?: unknown; accessSignature?: unknown };
  const slug = typeof body.slug === "string" ? body.slug : "";
  const pageId = normalizeNotionId(body.pageId);
  const trail = Array.isArray(body.trail) ? body.trail.map(normalizeNotionId).filter(Boolean).slice(0, 8) : [];
  const accessSignature = typeof body.accessSignature === "string" ? body.accessSignature : "";
  const cursor = normalizeNotionCursor(body.cursor);
  if (!slug || slug.length > 180 || !pageId || (body.cursor != null && !cursor)) return error(400, "Invalid child page request");
  try {
    const parent = await findSitePage(env, slug);
    if (!parent) return error(404, "Page not found");
    const childPage = await resolveChildPage(env, parent, trail, pageId, accessSignature);
    if (!childPage) return error(404, "没有找到这个子页面，或它已从当前页面移除");
    return childPageResponse(env, childPage, parent, cursor, urlBoolean(new URL(request.url), "headings"));
  } catch (reason) { return notionError(reason); }
}

async function childPageResponse(env: Env, childPage: any, rootPage: any, cursor = "", headingsOnly = false, privateSlug = ""): Promise<Response> {
  if (headingsOnly) {
    // A table of contents is a page-level index, not a projection of whichever
    // body chunk happened to load first. Wait for every Notion cursor here so
    // the client can only ever replace its TOC with a complete result.
    const index = await advanceHeadingIndex(env, childPage.id, childPage.last_edited_time || "");
    if (!index.complete) return Response.json({ pending: true }, { status: 202, headers: { ...jsonHeaders, "cache-control": "no-store", "retry-after": "1" } });
    return Response.json({ child: { id: childPage.id, headings: index.headings } }, { headers: { ...jsonHeaders, "cache-control": "private, max-age=300" } });
  }
  const blockState = newBlockReadState();
  const chunk = await getBlockChildrenChunk(env, childPage.id, blockState, 0, cursor);
  // Never expose a partial TOC derived from a body chunk. The dedicated
  // headings request below traverses the full Notion page independently.
  const headings = cursor ? undefined : [];
  await Promise.all([
    attachPreviewSignatures(chunk.blocks, env.NOTION_TOKEN),
    attachChildAccessSignatures(chunk.blocks, env, rootPage.id),
    attachMediaAccessSignatures(chunk.blocks, env.NOTION_TOKEN, rootPage, childPage, privateSlug),
  ]);
  const accessSignature = await createChildAccessSignature(env.NOTION_TOKEN!, normalizeNotionId(rootPage.id)!, normalizeNotionId(childPage.id)!);
  return Response.json({ child: {
    id: childPage.id,
    title: notionPageTitle(childPage) || "未命名子页面",
    icon: childPage.icon?.type === "emoji" ? childPage.icon.emoji : undefined,
    accessSignature,
    blocks: chunk.blocks,
    headings,
    nextCursor: chunk.nextCursor,
    truncated: blockState.truncated,
  } }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
}

async function advanceHeadingIndex(env: Env, pageId: string, version: string): Promise<{ complete: boolean; headings: HeadingSummary[] }> {
  const cacheKey = `${pageId}:${version}`;
  const cached = headingIndexCache.get(cacheKey);
  if (cached?.headings && cached.expiresAt > Date.now()) return { complete: true, headings: cached.headings };
  const persisted = env.DB ? await readHeadingCache(env.DB, pageId, version) : null;
  if (persisted) {
    setBoundedMap(headingIndexCache, cacheKey, { headings: persisted, expiresAt: Date.now() + 10 * 60 * 1000 }, 256);
    return { complete: true, headings: persisted };
  }

  const job = (env.DB ? await readHeadingJob(env.DB, pageId, version) : headingJobCache.get(cacheKey))
    || { queue: [{ kind: "page", parentId: pageId, cursor: "", depth: 0 }], headings: [] };
  let notionRequests = 0;
  // Keep each HTTP request comfortably below reverse-proxy timeouts. Large
  // Notion pages resume from D1 on the next request and reveal no partial TOC.
  while (job.queue.length && notionRequests < 4) {
    const task = job.queue.shift()!;
    if (task.kind === "heading") {
      job.headings.push(task.heading);
      continue;
    }
    if (task.depth > MAX_BLOCK_DEPTH) continue;
    const query = new URLSearchParams({ page_size: "100" });
    if (task.cursor) query.set("start_cursor", task.cursor);
    const payload = await notionFetch(env, `/blocks/${task.parentId}/children?${query}`);
    notionRequests += 1;
    const nextTasks: HeadingIndexTask[] = [];
    for (const raw of payload.results || []) {
      if (/^heading_[123]$/.test(raw.type)) {
        const label = richText(raw[raw.type]?.rich_text || []).trim();
        if (label) nextTasks.push({ kind: "heading", heading: { id: raw.id, label, level: Number(raw.type.at(-1)) } });
      }
      if (raw.has_children && raw.type !== "child_page" && raw.type !== "child_database") {
        nextTasks.push({ kind: "page", parentId: raw.id, cursor: "", depth: task.depth + 1 });
      }
    }
    if (payload.has_more && typeof payload.next_cursor === "string") {
      nextTasks.push({ kind: "page", parentId: task.parentId, cursor: payload.next_cursor, depth: task.depth });
    }
    job.queue.unshift(...nextTasks);
  }

  if (job.queue.length) {
    if (env.DB) await writeHeadingJob(env.DB, pageId, version, job);
    else setBoundedMap(headingJobCache, cacheKey, job, 256);
    return { complete: false, headings: [] };
  }
  if (env.DB) {
    await writeHeadingCache(env.DB, pageId, version, job.headings);
    await deleteHeadingJob(env.DB, pageId);
  } else headingJobCache.delete(cacheKey);
  setBoundedMap(headingIndexCache, cacheKey, { headings: job.headings, expiresAt: Date.now() + 10 * 60 * 1000 }, 256);
  return { complete: true, headings: job.headings };
}

function urlBoolean(url: URL, key: string): boolean { return /^(?:1|true|yes)$/i.test(url.searchParams.get(key) || ""); }

async function readJsonRequest(request: Request, maximumBytes = 16 * 1024): Promise<{ body: Record<string, unknown> } | { response: Response }> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLocaleLowerCase();
  if (contentType !== "application/json") return { response: error(415, "Content-Type must be application/json") };
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) return { response: error(413, "Request body is too large") };
  const reader = request.body?.getReader();
  if (!reader) return { response: error(400, "Invalid JSON body") };
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel("request body exceeds configured limit");
        return { response: error(413, "Request body is too large") };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  try {
    const body = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body) ? { body } : { response: error(400, "Invalid JSON body") };
  } catch { return { response: error(400, "Invalid JSON body") }; }
}

function checkExpensiveRequest(request: Request, route: string, limit: number, windowMs: number): Response | null {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "unknown";
  const key = `${route}:${ip}`;
  const now = Date.now();
  const current = expensiveRequestWindows.get(key);
  if (!current || current.startedAt <= now - windowMs) {
    expensiveRequestWindows.set(key, { startedAt: now, count: 1 });
  } else if (current.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1000));
    return Response.json({ error: "请求过于频繁，请稍后再试" }, { status: 429, headers: { ...jsonHeaders, "cache-control": "no-store", "retry-after": String(retryAfter) } });
  } else {
    current.count += 1;
  }
  if (expensiveRequestWindows.size > 2_000) {
    for (const [windowKey, window] of expensiveRequestWindows) if (window.startedAt <= now - windowMs) expensiveRequestWindows.delete(windowKey);
  }
  return null;
}

async function notionChildDatabase(env: Env, request: Request): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  const parsed = await readJsonRequest(request);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body as { slug?: unknown; databaseId?: unknown; trail?: unknown; contentKind?: unknown };
  const slug = typeof body.slug === "string" ? body.slug : "";
  const databaseId = normalizeNotionId(body.databaseId);
  const trail = Array.isArray(body.trail) ? body.trail.map(normalizeNotionId).filter(Boolean).slice(0, 8) : [];
  if (!slug || !databaseId) return error(400, "Invalid child database request");
  try {
    const root = body.contentKind === "page" ? await findSitePage(env, slug) : await findPost(env, slug);
    if (!root) return error(404, "Parent page not found");
    if (body.contentKind !== "page" && plain(root.properties?.password) && !await hasUnlockSession(request, env.NOTION_TOKEN, slug)) return error(403, "请先解锁父文章");
    const parent = trail.length ? await authorizedChildPage(env, root, trail) : root;
    if (!parent) return error(404, "Parent page not found");
    const state = newBlockReadState();
    const blocks = await getBlockChildren(env, parent.id, state, 0);
    if (!referencesDatabase(blocks, databaseId)) return error(404, "Child database not found");
    const database = await notionFetch(env, `/databases/${databaseId}`);
    const dataSourceId = normalizeNotionId(database.data_sources?.[0]?.id) || databaseId;
    const result = await notionFetch(env, `/data_sources/${dataSourceId}/query`, { method: "POST", body: JSON.stringify({ page_size: 100 }) });
    const pages: any[] = Array.isArray(result.results) ? result.results : [];
    const configRows = await queryConfigRows(env).catch(() => []);
    const publicFields = new Set(configRows
      .filter((row) => configPageKey(row) === "DATABASE_PUBLIC_FIELDS" && row.properties?.["启用"]?.checkbox === true)
      .flatMap((row) => configPageValue(row).split(/[\n,，|｜]+/))
      .map((name) => name.trim())
      .filter(Boolean));
    const safePropertyTypes = new Set(["rich_text", "number", "select", "multi_select", "date", "checkbox", "url", "email", "phone_number"]);
    const rows = pages.map((page: any) => ({
      id: page.id,
      title: notionPageTitle(page) || "未命名条目",
      icon: page.icon?.type === "emoji" ? page.icon.emoji : undefined,
      fields: Object.entries(page.properties || {})
        .filter(([name, property]: [string, any]) => publicFields.has(name) && safePropertyTypes.has(property?.type))
        .slice(0, 6)
        .map(([name, property]) => ({ name, value: notionPropertyText(property) }))
        .filter((field) => field.value),
    }));
    return Response.json({ database: { id: databaseId, title: richText(database.title) || "子数据库", rows } }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
  } catch (reason) { return notionError(reason); }
}

async function attachPreviewSignatures(blocks: any[], secret: string | undefined): Promise<void> {
  if (!secret) return;
  const bookmarks: any[] = [];
  const visit = (items: any[]) => {
    for (const block of items) {
      if (block.type === "bookmark" && typeof block.url === "string" && isSafeExternalUrl(block.url)) bookmarks.push(block);
      if (Array.isArray(block.children)) visit(block.children);
    }
  };
  visit(blocks);
  await Promise.all(bookmarks.map(async (block) => { block.previewSignature = await signPreviewUrl(secret, block.url); }));
}

async function attachChildAccessSignatures(blocks: any[], env: Env, rootPageId: string): Promise<void> {
  if (!env.NOTION_TOKEN) return;
  const targets: Array<{ target: any; pageId: string }> = [];
  const visit = (items: any[]) => {
    for (const block of items || []) {
      if (block.type === "child_page" && normalizeNotionId(block.pageId)) targets.push({ target: block, pageId: normalizeNotionId(block.pageId) });
      for (const item of block.richText || []) {
        const pageId = notionPageIdFromUrl(item.href);
        if (pageId) targets.push({ target: item, pageId });
      }
      if (Array.isArray(block.children)) visit(block.children);
    }
  };
  visit(blocks);
  const uniquePageIds = [...new Set(targets.filter(({ target }) => target.type === "child_page").map(({ pageId }) => pageId))];
  const pageMetadata = await readNotionPageMetadata(env, uniquePageIds);
  await Promise.all(targets.map(async ({ target, pageId }) => {
    target.accessSignature = await createChildAccessSignature(env.NOTION_TOKEN!, normalizeNotionId(rootPageId), pageId);
    if (target.type === "child_page") {
      const page = pageMetadata.get(pageId);
      if (page?.icon?.type === "emoji" && typeof page.icon.emoji === "string") target.icon = page.icon.emoji;
      else delete target.icon;
    }
  }));
}

async function attachMediaAccessSignatures(blocks: any[], secret: string | undefined, rootPage: any, ownerPage: any, privateSlug = ""): Promise<void> {
  const rootId = normalizeNotionId(rootPage?.id);
  const ownerId = normalizeNotionId(ownerPage?.id);
  if (!secret || !rootId || !ownerId) return;
  const targets: any[] = [];
  const visit = (items: any[]) => {
    for (const block of items || []) {
      if (["image", "video", "audio", "pdf", "file"].includes(block.type) && typeof block.url === "string") {
        try {
          const source = new URL(block.url);
          if (source.protocol === "https:" && NOTION_FILE_HOSTS.has(source.hostname) && normalizeNotionId(block.id)) targets.push(block);
        } catch { /* Invalid resource URLs were already removed during normalization. */ }
      }
      if (Array.isArray(block.children)) visit(block.children);
    }
  };
  visit(blocks);
  const rootVersion = typeof rootPage.last_edited_time === "string" ? rootPage.last_edited_time : "";
  const ownerVersion = typeof ownerPage.last_edited_time === "string" ? ownerPage.last_edited_time : "";
  const expiresAt = Math.floor(Date.now() / 1000) + MEDIA_SIGNATURE_TTL_SECONDS;
  await Promise.all(targets.map(async (block) => {
    const blockId = normalizeNotionId(block.id);
    const query = new URLSearchParams({
      id: blockId,
      root: rootId,
      owner: ownerId,
      rootVersion,
      ownerVersion,
      expires: String(expiresAt),
      signature: await createMediaAccessSignature(secret, rootId, ownerId, blockId, rootVersion, ownerVersion, expiresAt, privateSlug),
    });
    if (privateSlug) query.set("private", privateSlug);
    block.url = `/_notion/media?${query}`;
  }));
}

async function notionSitemap(env: Env, requestUrl: URL): Promise<Response> {
  const base = publicSiteOrigin(env, requestUrl).origin;
  let posts: ReturnType<typeof toPost>[] = [];
  let pages: ReturnType<typeof toSitePagePost>[] = [];
  if (env.NOTION_TOKEN) {
    try {
      const [postPages, sitePages] = await Promise.all([queryPosts(env, undefined, 100), querySitePages(env, undefined, 100)]);
      posts = postPages.map(toPost).filter((post) => post.slug);
      pages = sitePages.map(toSitePagePost).filter((page) => page.slug && !isRssSitePage(page));
    }
    catch (reason) { console.error(reason instanceof Error ? reason.message : "Sitemap Notion request failed"); }
  }
  const seen = new Set<string>();
  const entry = (location: string, body: string) => seen.has(location) ? "" : (seen.add(location), `<url><loc>${location}</loc>${body}</url>`);
  const urls = [
    entry(`${base}/`, "<changefreq>daily</changefreq><priority>1.0</priority>"),
    ...posts.map((post) => entry(`${base}/blog/${encodeURIComponent(post.slug)}`, `${post.date ? `<lastmod>${escapeXml(post.date)}</lastmod>` : ""}<changefreq>weekly</changefreq><priority>0.7</priority>`)),
    ...pages.map((page) => entry(`${base}${sitePagePath(page)}`, "<changefreq>weekly</changefreq><priority>0.6</priority>")),
  ].join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { "content-type": "application/xml; charset=utf-8" } });
}

async function notionRss(env: Env, requestUrl: URL): Promise<Response> {
  const base = publicSiteOrigin(env, requestUrl).origin;
  let posts: ReturnType<typeof toPost>[] = [];
  let config = createDefaultSiteConfig();
  if (env.NOTION_TOKEN) {
    try {
      config = await queryPublicSiteConfig(env);
      if (!config.rssEnabled) return error(404, "RSS is disabled");
      posts = (await queryPosts(env, undefined, 100)).map(toPost).filter((post) => post.slug);
    }
    catch (reason) { console.error(reason instanceof Error ? reason.message : "RSS Notion request failed"); }
  }
  const items = posts.map((post) => {
    const link = `${base}/blog/${encodeURIComponent(post.slug)}`;
    const published = post.date ? new Date(`${post.date}T00:00:00Z`).toUTCString() : "";
    return `<item><title>${escapeXml(post.title)}</title><link>${escapeXml(link)}</link><guid isPermaLink="true">${escapeXml(link)}</guid>${published ? `<pubDate>${published}</pubDate>` : ""}<description>${escapeXml(post.summary)}</description><category>${escapeXml(post.category)}</category></item>`;
  }).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(config.siteTitle)}</title><link>${base}/</link><description>${escapeXml(config.siteDescription)}</description><language>${escapeXml(config.siteLanguage)}</language><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}</channel></rss>`;
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
}

async function queryPosts(env: Env, slug?: string, pageSize = 100, sourceId?: string): Promise<any[]> {
  const filters: any[] = [
    { property: "type", select: { equals: "Post" } },
    { property: "status", select: { equals: "Published" } },
  ];
  if (slug) filters.push({ property: "slug", rich_text: { equals: slug } });
  const results: any[] = [];
  let cursor: string | undefined;
  do {
    const payload = await notionFetch(env, `/data_sources/${sourceId || await resolveContentDataSourceId(env)}/query`, {
      method: "POST",
      body: JSON.stringify({ filter: { and: filters }, sorts: [{ property: "date", direction: "descending" }], page_size: pageSize, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    if (Array.isArray(payload.results)) results.push(...payload.results);
    cursor = !slug && payload.has_more && typeof payload.next_cursor === "string" ? payload.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function querySitePages(env: Env, slug?: string, pageSize = 100, sourceId?: string): Promise<any[]> {
  const filters: any[] = [
    { property: "type", select: { equals: "Page" } },
    { property: "status", select: { equals: "Published" } },
  ];
  if (slug) filters.push({ property: "slug", rich_text: { equals: slug } });
  const results: any[] = [];
  let cursor: string | undefined;
  do {
    const payload = await notionFetch(env, `/data_sources/${sourceId || await resolveContentDataSourceId(env)}/query`, {
      method: "POST",
      body: JSON.stringify({ filter: { and: filters }, sorts: [{ property: "date", direction: "descending" }], page_size: pageSize, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    if (Array.isArray(payload.results)) results.push(...payload.results);
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

async function querySiteLinks(env: Env, sourceId?: string): Promise<any[]> {
  const results: any[] = [];
  let cursor: string | undefined;
  do {
    const payload = await notionFetch(env, `/data_sources/${sourceId || await resolveContentDataSourceId(env)}/query`, {
      method: "POST",
      body: JSON.stringify({
        filter: { and: [
          { or: [
            { property: "type", select: { equals: "Page" } },
            { property: "type", select: { equals: "Link" } },
            { property: "type", select: { equals: "Notice" } },
          ] },
          { property: "status", select: { equals: "Published" } },
        ] },
        sorts: [{ property: "date", direction: "descending" }],
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    if (Array.isArray(payload.results)) results.push(...payload.results);
    cursor = payload.has_more && typeof payload.next_cursor === "string" ? payload.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function queryConfigRows(env: Env): Promise<NotionConfigPage[]> {
  const dataSourceId = env.NOTION_CONFIG_DATA_SOURCE_ID || DEFAULT_CONFIG_DATA_SOURCE_ID;
  if (!dataSourceId) return [];
  const cached = configRowsCache.get(dataSourceId);
  if (cached?.rows && cached.expiresAt > Date.now()) return cached.rows;
  if (cached?.pending) return cached.pending;

  const pending = queryConfigRowsUncached(env, dataSourceId)
    .then((rows) => {
      configRowsCache.set(dataSourceId, { rows, expiresAt: Date.now() + CONFIG_ROWS_CACHE_TTL_MS });
      if (configRowsCache.size > 8) {
        const oldestKey = configRowsCache.keys().next().value;
        if (oldestKey && oldestKey !== dataSourceId) configRowsCache.delete(oldestKey);
      }
      return rows;
    })
    .catch((reason) => {
      configRowsCache.delete(dataSourceId);
      throw reason;
    });
  configRowsCache.set(dataSourceId, { pending, expiresAt: 0 });
  return pending;
}

async function queryConfigRowsUncached(env: Env, dataSourceId: string): Promise<NotionConfigPage[]> {
  const pages: NotionConfigPage[] = [];
  let cursor: string | undefined;
  do {
    const payload = await notionFetch(env, `/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    if (Array.isArray(payload.results)) pages.push(...payload.results);
    cursor = payload.has_more && typeof payload.next_cursor === "string" ? payload.next_cursor : undefined;
  } while (cursor);
  return pages.sort((left, right) => configPageOrder(left) - configPageOrder(right));
}

function configPageOrder(page: NotionConfigPage): number {
  const order = page.properties?.["排序"]?.number;
  return typeof order === "number" && Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
}

async function queryPublicSiteConfig(env: Env) {
  return toPublicSiteConfig(await queryConfigRows(env));
}

function configuredContentDataSourceId(env: Env, rows: any[]): string {
  const row = rows.find((page) => configPageKey(page) === "NOTION_DATA_SOURCE_ID" && page.properties?.["启用"]?.checkbox === true);
  const fromConfig = normalizeNotionId(row ? configPageValue(row) : "");
  return fromConfig || (env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID).trim();
}

async function resolveContentDataSourceId(env: Env): Promise<string> {
  if (!env.NOTION_CONFIG_DATA_SOURCE_ID && env.NOTION_DATA_SOURCE_ID) return env.NOTION_DATA_SOURCE_ID.trim();
  const cacheKey = env.NOTION_CONFIG_DATA_SOURCE_ID || DEFAULT_CONFIG_DATA_SOURCE_ID || "no-config";
  const cached = contentSourceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.id;
  const id = configuredContentDataSourceId(env, await queryConfigRows(env).catch(() => []));
  if (!id) throw new Error("Notion content Data Source ID is not configured");
  setBoundedMap(contentSourceCache, cacheKey, { id, expiresAt: Date.now() + 5 * 60 * 1000 }, 8);
  return id;
}

type BlockReadState = { remaining: number; truncated: boolean };

function newBlockReadState(): BlockReadState { return { remaining: MAX_BLOCKS, truncated: false }; }

async function getBlockChildrenChunk(env: Env, id: string, budget: BlockReadState, depth: number, startCursor = "") {
  if (depth > MAX_BLOCK_DEPTH || budget.remaining <= 0) {
    budget.truncated = true;
    return { blocks: [] as any[], nextCursor: undefined as string | undefined };
  }
  const blocks: any[] = [];
  let cursor = startCursor || undefined;
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
      blocks.push(block);
    }
    const nextCursor = payload.has_more && budget.remaining > 0 && typeof payload.next_cursor === "string"
      ? normalizeNotionCursor(payload.next_cursor) || undefined
      : undefined;
    if (payload.has_more && !nextCursor) budget.truncated = true;
    if (!nextCursor || blocks.length >= CONTENT_CHUNK_BLOCKS) return { blocks, nextCursor };
    cursor = nextCursor;
  } while (cursor);
  return { blocks, nextCursor: undefined as string | undefined };
}

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

async function getBlockHeadings(env: Env, id: string): Promise<HeadingSummary[]> {
  const result: HeadingSummary[] = [];
  const visit = async (parentId: string, depth: number): Promise<void> => {
    if (depth > MAX_BLOCK_DEPTH) return;
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ page_size: "100" });
      if (cursor) query.set("start_cursor", cursor);
      const payload = await notionFetch(env, `/blocks/${parentId}/children?${query}`);
      for (const raw of payload.results || []) {
        if (/^heading_[123]$/.test(raw.type)) {
          const level = Number(raw.type.at(-1));
          const label = richText(raw[raw.type]?.rich_text || []).trim();
          if (label) result.push({ id: raw.id, label, level });
        }
        if (raw.has_children && raw.type !== "child_page" && raw.type !== "child_database") await visit(raw.id, depth + 1);
      }
      cursor = payload.has_more && typeof payload.next_cursor === "string" ? payload.next_cursor : undefined;
    } while (cursor);
  };
  await visit(id, 0);
  return result;
}

async function readArticleChunk(env: Env, pageId: string, budget: BlockReadState, cursor = "") {
  const chunk = await getBlockChildrenChunk(env, pageId, budget, 0, cursor);
  if (cursor) return { chunk, headings: undefined as HeadingSummary[] | undefined };
  // Most articles fit in the initial chunk. Reuse its normalized block tree
  // for the TOC instead of traversing the same Notion blocks a second time.
  if (!chunk.nextCursor && !budget.truncated) return { chunk, headings: headingsFromBlocks(chunk.blocks) };
  // Long/deep pages still receive a complete index, but only pay the second
  // traversal when the first chunk cannot contain the whole article.
  return { chunk, headings: await getBlockHeadings(env, pageId) };
}

function headingsFromBlocks(blocks: any[]): HeadingSummary[] {
  const result: HeadingSummary[] = [];
  const visit = (items: any[]) => {
    for (const block of items || []) {
      if (/^heading_[123]$/.test(block.type)) {
        const label = Array.isArray(block.richText) ? block.richText.map((item: any) => item.text || "").join("").trim() : "";
        if (label) result.push({ id: block.id, label, level: Number(block.type.at(-1)) });
      }
      if (Array.isArray(block.children)) visit(block.children);
    }
  };
  visit(blocks);
  return result;
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

function setBoundedMap<K, V>(map: Map<K, V>, key: K, value: V, limit: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function blockText(blocks: any[], includeCode = false, maxChars = MAX_INDEX_CHARS_PER_POST): string {
  const fragments: string[] = [];
  let length = 0;
  const visit = (items: any[]) => {
    for (const block of items || []) {
      if (length >= maxChars) return;
      if (block.type === "code" && !includeCode) continue;
      const rich = Array.isArray(block.richText) ? block.richText.map((item: any) => item.text || "").join("") : "";
      if (rich) { fragments.push(rich); length += rich.length + 1; }
      if (typeof block.caption === "string" && block.caption) { fragments.push(block.caption); length += block.caption.length + 1; }
      if (Array.isArray(block.children)) visit(block.children);
    }
  };
  visit(blocks);
  return fragments.join("\n").slice(0, maxChars);
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

function toSiteNotice(page: any) {
  const properties = page.properties || {};
  return {
    id: page.id,
    title: (title(properties.title) || "公告").replace(/_+$/, ""),
    summary: plain(properties.summary),
    icon: notionDisplayEmoji(page),
    date: properties.date?.date?.start || page.created_time?.slice(0, 10) || "",
  };
}

function sitePagePath(page: ReturnType<typeof toSitePagePost>): string {
  return page.slug === "me" || page.title.includes("关于") ? "/about" : `/page/${encodeURIComponent(page.slug)}`;
}

function isRssSitePage(page: ReturnType<typeof toSitePagePost>): boolean {
  return /^rss(?:\/feed\.xml|\.xml)?$/i.test(page.slug.trim()) || /^rss(?:\s|$)/i.test(page.title.trim());
}

function toSiteLink(page: any) {
  const properties = page.properties || {};
  const configLink = isConfigLinkPage(page);
  const contentType = configLink ? "Link" : properties.type?.select?.name;
  const configKey = configPageKey(page);
  const configTitle = configKey.replace(/^LINK(?::|_)?/, "").trim();
  const linkTitle = (configLink ? configTitle || plain(properties["备注"]) || "链接" : title(properties.title) || "未命名链接").replace(/_+$/, "");
  const pageSlug = configLink ? configPageValue(page) : plain(properties.slug).trim();
  const isAbout = pageSlug === "me" || linkTitle.includes("关于");
  const configuredTarget = configLink ? safeNavigationTarget(pageSlug) : [properties.slug, ...Object.values(properties).filter((property) => property !== properties.slug)]
    .map(notionPropertyLink)
    .find(Boolean) || pageSlug;
  const target = configuredTarget;
  const isInternalPage = contentType === "Page";
  const pageHref = isInternalPage
    ? isAbout ? "/about" : pageSlug ? `/page/${encodeURIComponent(pageSlug)}` : `/page/${encodeURIComponent(page.id)}`
    : "";
  const external = !pageHref && /^https?:\/\//i.test(target);
  const internal = /^\/(?!\/)/.test(target);
  const rss = /^\/?rss(?:\/feed\.xml|\.xml)?\/?$/i.test(target)
    || /^rss(?:\s|$)/i.test(linkTitle);
  const href = rss ? "/rss.xml" : pageHref || (external || internal ? target : "");
  return {
    id: page.id,
    title: linkTitle,
    href,
    summary: configLink ? plain(properties["备注"]) : plain(properties.summary),
    icon: notionDisplayEmoji(page),
    external,
    kind: rss ? "rss" as const : isInternalPage ? "nav" as const : "tool" as const,
  };
}

function toSiteLinks(pages: any[]) {
  const seen = new Set<string>();
  return pages.map(toSiteLink).filter((link) => {
    if (!link.href || link.title.includes("归档") || /(?:^|\/)archive(?:\/|$|#)/i.test(link.href)) return false;
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
      const publishedTarget = (await querySitePages(env, undefined, 100))
        .find((page) => normalizeNotionId(page.id) === pageId && !plain(page.properties?.password));
      if (!publishedTarget) return null;
      candidate = publishedTarget;
    }
    currentPage = candidate;
  }
  return currentPage === rootPage ? null : currentPage;
}

async function resolveAuthorizedChildPage(env: Env, rootPage: any, trail: string[], pageId: string): Promise<any | null> {
  const normalizedTrail = trail.filter((id, index, items) => id !== pageId && items.indexOf(id) === index);
  if (normalizedTrail.length) {
    const throughVisibleTrail = await authorizedChildPage(env, rootPage, [...normalizedTrail, pageId]);
    if (throughVisibleTrail) return throughVisibleTrail;
  }
  // Browser history and cross-links can carry a stale visual trail. The target
  // is still safe when Notion proves it descends from (or is directly
  // referenced by) the already-authorized root page.
  return authorizedChildPage(env, rootPage, [pageId]);
}

async function resolveChildPage(env: Env, rootPage: any, trail: string[], pageId: string, accessSignature: string): Promise<any | null> {
  const rootId = normalizeNotionId(rootPage.id);
  // A signature proves that the UI previously saw a link; it never grants
  // access by itself. Notion ancestry/reference policy is revalidated on every
  // request so unpublished rich-text targets and removed links stay closed.
  if (rootId && accessSignature) await verifyChildAccessSignature(env.NOTION_TOKEN || "", rootId, pageId, accessSignature);
  return resolveAuthorizedChildPage(env, rootPage, trail, pageId);
}

function referencesPage(blocks: any[], pageId: string): boolean {
  for (const block of blocks) {
    if (normalizeNotionId(block.pageId) === pageId) return true;
    if (block.richText?.some((item: any) => notionPageIdFromUrl(item.href) === pageId)) return true;
    if (block.children?.length && referencesPage(block.children, pageId)) return true;
  }
  return false;
}

function referencesDatabase(blocks: any[], databaseId: string): boolean {
  return blocks.some((block) => normalizeNotionId(block.databaseId) === databaseId || (block.children?.length && referencesDatabase(block.children, databaseId)));
}

function notionPropertyText(property: any): string {
  if (!property) return "";
  if (property.type === "select") return property.select?.name || "";
  if (property.type === "multi_select") return (property.multi_select || []).map((item: any) => item.name).join("、");
  if (property.type === "date") return property.date?.start || "";
  if (property.type === "checkbox") return property.checkbox ? "是" : "否";
  if (property.type === "number") return property.number == null ? "" : String(property.number);
  if (property.type === "url" || property.type === "email" || property.type === "phone_number") return property[property.type] || "";
  if (property.type === "status") return property.status?.name || "";
  return plain(property);
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
  const targetPage = await notionFetch(env, `/pages/${childId}`);
  if (targetPage?.archived || targetPage?.in_trash) return null;
  let parent = targetPage.parent;
  for (let depth = 0; depth < 20; depth++) {
    const pageParentId = normalizeNotionId(parent?.page_id);
    if (pageParentId) {
      if (pageParentId === ancestorId) return targetPage;
      const page = await notionFetch(env, `/pages/${pageParentId}`);
      if (page?.archived || page?.in_trash) return null;
      parent = page.parent;
      continue;
    }
    const blockParentId = normalizeNotionId(parent?.block_id);
    if (blockParentId) {
      const block = await notionFetch(env, `/blocks/${blockParentId}`);
      if (block?.archived || block?.in_trash) return null;
      parent = block.parent;
      continue;
    }
    return null;
  }
  return null;
}

function notionPageTitle(page: any): string {
  const property = Object.values(page.properties || {}).find((value: any) => value?.type === "title" || Array.isArray(value?.title));
  return title(property);
}

function normalizeRichText(value: any[] = []) {
  return value.map((item) => ({
    text: item.plain_text || item.text?.content || "",
    href: safeRichTextHref(item.href),
    bold: item.annotations?.bold || undefined,
    italic: item.annotations?.italic || undefined,
    code: item.annotations?.code || undefined,
    strikethrough: item.annotations?.strikethrough || undefined,
    underline: item.annotations?.underline || undefined,
    color: item.annotations?.color && item.annotations.color !== "default" ? item.annotations.color : undefined,
  }));
}

function bookmarkTitle(url: unknown): string {
  if (typeof url !== "string") return "网页链接";
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./i, "").toLocaleLowerCase();
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
      const url = safeResourceUrl(value.type === "external" ? value.external?.url : value.file?.url);
      return { ...base, url, caption: richText(value.caption) };
    }
    case "bookmark": case "embed": case "video": case "file": case "pdf": case "audio": case "link_preview": {
      const url = safeResourceUrl(value.url || value.external?.url || value.file?.url, type === "embed");
      const normalizedType = type === "link_preview" ? "bookmark" : type;
      const caption = richText(value.caption) || (normalizedType === "bookmark" ? bookmarkTitle(url) : "");
      return { ...base, type: normalizedType, url, caption };
    }
    case "child_page": return { ...base, caption: value.title || "子页面", pageId: normalizeNotionId(raw.id) };
    case "child_database": return { ...base, caption: value.title || "子数据库", databaseId: normalizeNotionId(raw.id) };
    case "link_to_page": {
      const pageId = normalizeNotionId(value.page_id);
      const databaseId = normalizeNotionId(value.database_id);
      return pageId ? { ...base, type: "child_page", caption: "关联页面", pageId } : databaseId ? { ...base, type: "child_database", caption: "关联数据库", databaseId } : { ...base, type: "unsupported" };
    }
    case "equation": return { ...base, caption: value.expression || "" };
    case "table_row": return { ...base, children: (value.cells || []).map((cell: any[], index: number) => ({ id: `${raw.id}-cell-${index}`, type: "table_cell", richText: normalizeRichText(cell) })) };
    case "unsupported": return { ...base, type: "unsupported" };
    default: return raw.has_children ? base : { ...base, type: "unsupported" };
  }
}

function safeRichTextHref(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const target = value.trim();
  if (!target || target.length > 2_048) return undefined;
  if (/^(?:#|\/(?!\/))/.test(target)) return target;
  try {
    const url = new URL(target);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

function safeResourceUrl(value: unknown, httpsOnly = false): string | undefined {
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password) return undefined;
    if (httpsOnly) return url.protocol === "https:" ? url.href : undefined;
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch { return undefined; }
}

function escapeXml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char] || char)); }

function publicSiteOrigin(env: Env, requestUrl: URL): URL {
  try {
    const configured = new URL(env.SITE_URL || "");
    if (configured.protocol === "https:" || configured.protocol === "http:") return configured;
  } catch { /* Fall back to the actual Worker/custom-domain request. */ }
  const origin = new URL(requestUrl.origin);
  if (origin.protocol === "http:" && origin.hostname !== "localhost" && origin.hostname !== "127.0.0.1") origin.protocol = "https:";
  return origin;
}

function setSiteOriginHeader(headers: Headers, env: Env, requestUrl: URL): void {
  headers.set("x-blog-site-origin", publicSiteOrigin(env, requestUrl).origin);
}

function setSiteConfigHeader(headers: Headers, config?: SiteConfigPayload): void {
  if (!config) return;
  headers.set("x-blog-site-config", encodeURIComponent(JSON.stringify(config)));
}

function requestWithSiteOrigin(request: Request, env: Env): Request {
  const headers = new Headers(request.headers);
  setSiteOriginHeader(headers, env, new URL(request.url));
  return new Request(request, { headers });
}

function withHead(request: Request, response: Response) {
  return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
}

function allowedMethodsForPath(pathname: string): string[] | undefined {
  if (["/sitemap.xml", "/rss.xml", "/favicon.ico", "/api/content/posts", "/_notion/image", "/_notion/media", "/api/health"].includes(pathname)) return ["GET", "HEAD"];
  if (pathname.startsWith("/_notion/config-image/")) return ["GET", "HEAD"];
  if (["/api/content/navigation", "/api/content/config", "/api/content/search", "/api/content/rss-feeds", "/api/content/link-preview", "/api/content/word-cloud", "/api/content/unlock-session"].includes(pathname)) return ["GET"];
  if (["/api/content/child", "/api/content/page-child", "/api/content/database"].includes(pathname)) return ["POST"];
  if (pathname.startsWith("/api/content/post/")) return ["GET", "POST"];
  if (pathname.startsWith("/api/content/page/")) return ["GET"];
  return undefined;
}

function secureDocumentResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  if ((headers.get("content-type") || "").toLocaleLowerCase().includes("text/html")) {
    // Regular document fetches and browser navigations advertise different
    // Accept strings even though they receive identical HTML. Keeping Accept
    // in Vary prevents an interaction-time warmup from being reused and also
    // fragments Cloudflare's document cache. RSC remains isolated by its own
    // URL/headers and is never emitted as text/html.
    const vary = (headers.get("vary") || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value && value.toLocaleLowerCase() !== "accept");
    if (vary.length) headers.set("vary", vary.join(", "));
    else headers.delete("vary");
    headers.set("x-frame-options", "SAMEORIGIN");
    headers.set("cross-origin-opener-policy", "same-origin");
    headers.set("content-security-policy", [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https: data: blob:",
      "font-src 'self' data:",
      "media-src 'self' https: blob:",
      "frame-src https:",
      "connect-src 'self' https: https://cloudflareinsights.com",
    ].join("; "));
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function renderRouteSlug(pathSegment: string): string {
  return decodeRouteSegment(pathSegment.endsWith(".rsc") ? pathSegment.slice(0, -4) : pathSegment);
}

function error(status: number, message: string) { return Response.json({ error: message }, { status, headers: { ...jsonHeaders, "cache-control": "no-store" } }); }
function notionError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "Notion request failed";
  console.error(message);
  return error(502, "文章暂时无法读取");
}

export default worker;
