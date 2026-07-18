/** Cloudflare Worker entry point with a small Notion content gateway. */
/* eslint-disable @typescript-eslint/no-explicit-any -- Notion block/property unions are normalized at this gateway boundary. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { clearPasswordAttempts, getPasswordAttemptStatus, recordPasswordFailure } from "../db/rate-limit";
import { clearArticlePayload, storeArticlePayload, type ArticlePayload } from "../server/article-context";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  NOTION_TOKEN?: string;
  NOTION_DATA_SOURCE_ID?: string;
  IMAGES: {
    input(stream: ReadableStream): { transform(options: Record<string, unknown>): { output(options: { format: string; quality: number }): Promise<{ response(): Response }> } };
  };
}
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }

const DEFAULT_DATA_SOURCE_ID = "fffad771-48f4-81f5-be17-000b319f85ad";
const NOTION_VERSION = "2026-03-11";
const NOTION_IMAGE_HOSTS = new Set(["prod-files-secure.s3.us-west-2.amazonaws.com"]);
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/sitemap.xml" && (request.method === "GET" || request.method === "HEAD")) return withHead(request, await notionSitemap(env));
    if (url.pathname === "/rss.xml" && (request.method === "GET" || request.method === "HEAD")) return withHead(request, await notionRss(env));
    if (url.pathname === "/api/content/posts" && request.method === "GET") return notionPosts(env);
    if (url.pathname === "/_notion/image" && (request.method === "GET" || request.method === "HEAD")) return notionImage(request, env);
    if (url.pathname.startsWith("/api/content/post/") && (request.method === "GET" || request.method === "POST")) {
      const slug = decodeURIComponent(url.pathname.slice("/api/content/post/".length));
      return notionPost(env, slug, request);
    }
    if (url.pathname === "/api/health") return Response.json({ ok: true, notionConfigured: Boolean(env.NOTION_TOKEN) }, { headers: { "cache-control": "no-store" } });

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
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
    return handler.fetch(request, env, ctx);
  },
};

async function notionImage(request: Request, env: Env): Promise<Response> {
  const rawUrl = new URL(request.url).searchParams.get("url");
  let source: URL;
  try { source = new URL(rawUrl || ""); }
  catch { return error(400, "Invalid image URL"); }
  if (source.protocol !== "https:" || !NOTION_IMAGE_HOSTS.has(source.hostname)) return error(400, "Image host is not allowed");
  const upstream = await fetch(source, { redirect: "manual" });
  if (!upstream.ok || !upstream.body) return error(upstream.status || 502, "Image is temporarily unavailable");
  if (!upstream.headers.get("content-type")?.toLocaleLowerCase().startsWith("image/")) return error(415, "Unsupported image response");
  try {
    const transformed = await env.IMAGES.input(upstream.body).transform({ width: 2400 }).output({ format: "image/webp", quality: 86 });
    const response = await transformed.response();
    const headers = new Headers(response.headers);
    headers.set("cache-control", "public, max-age=3600");
    headers.set("x-content-type-options", "nosniff");
    return request.method === "HEAD" ? new Response(null, { status: response.status, headers }) : new Response(response.body, { status: response.status, headers });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "Notion image conversion failed";
    console.error(detail);
    return Response.json({ error: "Image conversion failed", detail: detail.replace(/https?:\/\/\S+/g, "[url]").slice(0, 180) }, { status: 502, headers: { ...jsonHeaders, "cache-control": "no-store" } });
  }
}

async function articlePayloadForRender(env: Env, slug: string, request: Request): Promise<ArticlePayload> {
  const response = await notionPost(env, slug, new Request(request.url, { headers: request.headers }));
  const payload = await response.json().catch(() => ({ error: "文章暂时无法读取" })) as ArticlePayload;
  return { ...payload, status: response.status };
}

async function notionPosts(env: Env): Promise<Response> {
  if (!env.NOTION_TOKEN) return error(503, "Notion connection is not configured");
  try {
    const pages = await queryPosts(env, undefined, 100);
    const posts = pages.map(toPost).filter((post) => post.slug);
    return Response.json({ posts, source: "notion" }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
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
    const pages = await queryPosts(env, slug, 1);
    const page = pages[0];
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
    const budget = { remaining: 2000 };
    const blocks = await getBlockChildren(env, page.id, budget, 0);
    return Response.json({ post: { ...post, locked: Boolean(expectedPassword) }, locked: false, blocks }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
  } catch (reason) { return notionError(reason); }
}

async function notionSitemap(env: Env): Promise<Response> {
  const base = "https://bblog.530555.xyz";
  let posts: ReturnType<typeof toPost>[] = [];
  if (env.NOTION_TOKEN) {
    try { posts = (await queryPosts(env, undefined, 100)).map(toPost).filter((post) => post.slug); }
    catch (reason) { console.error(reason instanceof Error ? reason.message : "Sitemap Notion request failed"); }
  }
  const urls = [`<url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`, ...posts.map((post) => `<url><loc>${base}/blog/${encodeURIComponent(post.slug)}</loc>${post.date ? `<lastmod>${escapeXml(post.date)}</lastmod>` : ""}<changefreq>weekly</changefreq><priority>0.7</priority></url>`)].join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": env.NOTION_TOKEN ? "no-store" : "public, max-age=60" } });
}

async function notionRss(env: Env): Promise<Response> {
  const base = "https://bblog.530555.xyz";
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

async function getBlockChildren(env: Env, id: string, budget: { remaining: number }, depth: number): Promise<any[]> {
  if (depth > 5 || budget.remaining <= 0) return [];
  const output: any[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const payload = await notionFetch(env, `/blocks/${id}/children?${query}`);
    for (const raw of payload.results || []) {
      if (--budget.remaining < 0) break;
      const block = normalizeBlock(raw);
      if (!block) continue;
      const hasInlineChildren = raw.has_children && raw.type !== "child_page" && raw.type !== "child_database";
      if (hasInlineChildren && budget.remaining > 0) block.children = await getBlockChildren(env, raw.id, budget, depth + 1);
      output.push(block);
    }
    cursor = payload.has_more && budget.remaining > 0 ? payload.next_cursor : undefined;
  } while (cursor);
  return output;
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
    icon: page.icon?.type === "emoji" ? page.icon.emoji : plain(properties.icon),
    locked: Boolean(plain(properties.password)),
  };
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
      return { ...base, type: type === "video" ? "embed" : type === "link_preview" ? "bookmark" : type, url, caption: richText(value.caption) };
    }
    case "child_page": return { ...base, caption: value.title || "子页面", url: `https://www.notion.so/${String(raw.id).replaceAll("-", "")}` };
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
