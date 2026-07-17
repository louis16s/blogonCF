/** Cloudflare Worker entry point with a small Notion content gateway. */
/* eslint-disable @typescript-eslint/no-explicit-any -- Notion block/property unions are normalized at this gateway boundary. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  NOTION_TOKEN?: string;
  NOTION_DATA_SOURCE_ID?: string;
  IMAGES: {
    input(stream: ReadableStream): { transform(options: Record<string, unknown>): { output(options: { format: string; quality: number }): Promise<{ response(): Response }> } };
  };
}
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }

const DEFAULT_DATA_SOURCE_ID = "fffad771-48f4-81f5-be17-000b319f85ad";
const NOTION_VERSION = "2026-03-11";
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/content/posts" && request.method === "GET") return notionPosts(env);
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
    return handler.fetch(request, env, ctx);
  },
};

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
        return Response.json({ post: { ...post, locked: true }, locked: true, error: supplied ? "密码不正确" : undefined }, { status: supplied ? 401 : 200, headers: { ...jsonHeaders, "cache-control": "no-store" } });
      }
    }
    const budget = { remaining: 600 };
    const blocks = await getBlockChildren(env, page.id, budget, 0);
    return Response.json({ post: { ...post, locked: Boolean(expectedPassword) }, locked: false, blocks }, { headers: { ...jsonHeaders, "cache-control": "no-store" } });
  } catch (reason) { return notionError(reason); }
}

async function queryPosts(env: Env, slug?: string, pageSize = 100): Promise<any[]> {
  const filters: any[] = [
    { property: "type", select: { equals: "Post" } },
    { property: "status", select: { equals: "Published" } },
  ];
  if (slug) filters.push({ property: "slug", rich_text: { equals: slug } });
  const payload = await notionFetch(env, `/data_sources/${env.NOTION_DATA_SOURCE_ID || DEFAULT_DATA_SOURCE_ID}/query`, {
    method: "POST",
    body: JSON.stringify({ filter: { and: filters }, sorts: [{ property: "date", direction: "descending" }], page_size: pageSize }),
  });
  return Array.isArray(payload.results) ? payload.results : [];
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
      if (raw.has_children && budget.remaining > 0) block.children = await getBlockChildren(env, raw.id, budget, depth + 1);
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
  return value.map((item) => ({ text: item.plain_text || item.text?.content || "", href: item.href || undefined, bold: item.annotations?.bold || undefined, italic: item.annotations?.italic || undefined, code: item.annotations?.code || undefined }));
}

function normalizeBlock(raw: any): any | null {
  const type = raw.type;
  const value = raw[type] || {};
  const base: any = { id: raw.id, type };
  if (Array.isArray(value.rich_text)) base.richText = normalizeRichText(value.rich_text);
  switch (type) {
    case "paragraph": case "heading_1": case "heading_2": case "heading_3": case "bulleted_list_item": case "numbered_list_item": case "quote": case "toggle": case "column": case "column_list": case "synced_block": return base;
    case "to_do": return { ...base, checked: Boolean(value.checked) };
    case "callout": return { ...base, icon: value.icon?.emoji || "i" };
    case "code": return { ...base, language: value.language || "plain text" };
    case "divider": return base;
    case "image": {
      const url = value.type === "external" ? value.external?.url : value.file?.url;
      return { ...base, url, caption: richText(value.caption) };
    }
    case "bookmark": case "embed": case "video": case "file": case "pdf": {
      const url = value.url || value.external?.url || value.file?.url;
      return { ...base, type: type === "video" ? "embed" : type, url, caption: richText(value.caption) };
    }
    default: return raw.has_children ? base : null;
  }
}

function error(status: number, message: string) { return Response.json({ error: message }, { status, headers: { ...jsonHeaders, "cache-control": "no-store" } }); }
function notionError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "Notion request failed";
  console.error(message);
  return error(502, "Notion content is temporarily unavailable");
}

export default worker;
