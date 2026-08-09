/* External metadata and feed gateway. Kept separate from the Notion/SSR router. */
/* eslint-disable @typescript-eslint/no-explicit-any -- normalized Notion blocks enter at this boundary. */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" };
const RSS_CACHE_TTL_MS = 15 * 60 * 1000;
const LINK_PREVIEW_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_LINK_PREVIEWS = 300;
const MAX_PREVIEW_BYTES = 600_000;
const MAX_FEED_BYTES = 1_000_000;
const EXTERNAL_FETCH_TIMEOUT_MS = 6_000;
const MAX_ACTIVE_PREVIEWS = 6;
const PREVIEW_RATE_WINDOW_MS = 60_000;
const PREVIEW_RATE_LIMIT = 24;
const MAX_PREVIEW_CLIENTS = 2_000;

export type ExternalFeedItem = { id: string; title: string; url: string; published: string; summary: string };
export type ExternalFeed = { url: string; title: string; source: string; items: ExternalFeedItem[] };
type LinkPreview = { title: string; subtitle: string; source: string };

const rssFeedCache = new Map<string, { expiresAt: number; feed: ExternalFeed | null }>();
const linkPreviewCache = new Map<string, { expiresAt: number; preview: LinkPreview }>();
const previewClients = new Map<string, { windowStartedAt: number; count: number }>();
let activePreviews = 0;

export function extractExternalUrls(blocks: any[]): string[] {
  const urls = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && isSafeExternalUrl(value)) urls.add(value.trim());
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

export function isSafeExternalUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLocaleLowerCase().replace(/^\[|\]$/g, "");
    if (!host || isBlockedHostname(host)) return false;
    return true;
  } catch { return false; }
}

function isBlockedHostname(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home") || host.endsWith(".corp")) return true;
  if (host.includes(":")) {
    const compact = host.replace(/^0+(?=[\da-f])/i, "");
    return compact === "::" || compact === "::1" || /^(?:fc|fd|fe[89a-f])/i.test(compact) || compact.startsWith("::ffff:");
  }
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const octets = host.split(".").map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 2 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0 && octets[2] === 113);
}

export async function externalLinkPreview(url: URL, request: Request): Promise<Response> {
  const target = url.searchParams.get("url")?.trim() || "";
  if (!target || target.length > 2_048 || !isSafeExternalUrl(target)) return jsonError(400, "Invalid link URL");
  const cached = linkPreviewCache.get(target);
  if (cached && cached.expiresAt > Date.now()) return previewResponse(cached.preview, 21_600);
  const retryAfter = previewRetryAfter(request);
  if (retryAfter) return Response.json({ error: "Too many preview requests" }, { status: 429, headers: { ...JSON_HEADERS, "cache-control": "no-store", "retry-after": String(retryAfter) } });
  if (activePreviews >= MAX_ACTIVE_PREVIEWS) return Response.json({ error: "Preview service is busy" }, { status: 503, headers: { ...JSON_HEADERS, "cache-control": "no-store", "retry-after": "2" } });
  const fallback: LinkPreview = { title: "", subtitle: "", source: externalSource(target, target) };
  activePreviews++;
  try {
    let current = target;
    for (let redirect = 0; redirect < 4; redirect++) {
      const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS), headers: { accept: "text/html,application/xhtml+xml;q=0.9", "user-agent": "blogonCF link preview" } });
      if (response.status >= 300 && response.status < 400) {
        const next = safeRedirect(response.headers.get("location"), current);
        if (!next) break;
        current = next;
        continue;
      }
      if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") || "")) break;
      if (Number(response.headers.get("content-length") || "0") > MAX_PREVIEW_BYTES) break;
      const metadata = htmlMetadata(await readLimitedText(response, MAX_PREVIEW_BYTES));
      const preview = { ...metadata, source: externalSource(current, fallback.source) };
      rememberPreview(target, preview, LINK_PREVIEW_CACHE_TTL_MS);
      return previewResponse(preview, 21_600);
    }
  } catch { /* A domain-only card is the intended fallback. */ }
  finally { activePreviews--; }
  rememberPreview(target, fallback, 10 * 60 * 1000);
  return previewResponse(fallback, 600);
}

export async function fetchExternalFeed(feedUrl: string): Promise<ExternalFeed | null> {
  if (!feedUrl || feedUrl.length > 2_048 || !isSafeExternalUrl(feedUrl)) return null;
  const cached = rssFeedCache.get(feedUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.feed;
  let current = feedUrl;
  try {
    for (let redirect = 0; redirect < 3; redirect++) {
      const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS), headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9" } });
      if (response.status >= 300 && response.status < 400) {
        const next = safeRedirect(response.headers.get("location"), current);
        if (!next) break;
        current = next;
        continue;
      }
      if (!response.ok || Number(response.headers.get("content-length") || "0") > MAX_FEED_BYTES) break;
      const feed = parseExternalFeed(await readLimitedText(response, MAX_FEED_BYTES), current);
      rssFeedCache.set(feedUrl, { expiresAt: Date.now() + RSS_CACHE_TTL_MS, feed });
      return feed;
    }
  } catch (reason) { console.warn(reason instanceof Error ? reason.message : "External RSS fetch failed"); }
  rssFeedCache.set(feedUrl, { expiresAt: Date.now() + RSS_CACHE_TTL_MS, feed: null });
  return null;
}

function previewRetryAfter(request: Request): number {
  const now = Date.now();
  const key = request.headers.get("cf-connecting-ip") || "unknown";
  const current = previewClients.get(key);
  if (!current || now - current.windowStartedAt >= PREVIEW_RATE_WINDOW_MS) {
    previewClients.set(key, { windowStartedAt: now, count: 1 });
    if (previewClients.size > MAX_PREVIEW_CLIENTS) previewClients.delete(previewClients.keys().next().value as string);
    return 0;
  }
  current.count++;
  return current.count > PREVIEW_RATE_LIMIT
    ? Math.max(1, Math.ceil((current.windowStartedAt + PREVIEW_RATE_WINDOW_MS - now) / 1000))
    : 0;
}

function safeRedirect(location: string | null, current: string): string {
  if (!location) return "";
  try {
    const next = new URL(location, current).toString();
    return isSafeExternalUrl(next) ? next : "";
  } catch { return ""; }
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
    if (size > limit) { await reader.cancel(); throw new Error("External response is too large"); }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

function rememberPreview(target: string, preview: LinkPreview, ttl: number) {
  linkPreviewCache.set(target, { expiresAt: Date.now() + ttl, preview });
  if (linkPreviewCache.size > MAX_LINK_PREVIEWS) linkPreviewCache.delete(linkPreviewCache.keys().next().value as string);
}

function previewResponse(preview: LinkPreview, maxAge: number) {
  return Response.json(preview, { headers: { ...JSON_HEADERS, "cache-control": `public, max-age=${maxAge}` } });
}

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: { ...JSON_HEADERS, "cache-control": "no-store" } });
}

function htmlMetadata(html: string): { title: string; subtitle: string } {
  const meta = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map<string, string>();
    for (const attribute of match[0].matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attributes.set(attribute[1].toLocaleLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
    const key = (attributes.get("property") || attributes.get("name") || "").toLocaleLowerCase();
    const content = attributes.get("content") || "";
    if (key && content && !meta.has(key)) meta.set(key, content);
  }
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return {
    title: cleanMetadata(meta.get("og:title") || meta.get("twitter:title") || titleMatch?.[1] || "", 140),
    subtitle: cleanMetadata(meta.get("og:description") || meta.get("description") || meta.get("twitter:description") || "", 240),
  };
}

function cleanMetadata(value: string, limit: number): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, limit);
}

function parseExternalFeed(xml: string, feedUrl: string): ExternalFeed | null {
  const isAtom = /<feed\b/i.test(xml);
  const chunks = [...xml.matchAll(isAtom ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi : /<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  if (!chunks.length) return null;
  const source = externalSource(feedUrl, "RSS");
  const feedTitle = limitedFeedText(xmlField(xml, "title"), 180) || source;
  const items = chunks.slice(0, 15).map((chunk, index) => {
    const url = isAtom ? atomLink(chunk) : xmlField(chunk, "link");
    return {
      id: `${feedUrl}#${url || index}`,
      title: limitedFeedText(xmlField(chunk, "title"), 180) || "未命名动态",
      url: isSafeExternalUrl(url) ? url : feedUrl,
      published: limitedFeedText(xmlField(chunk, isAtom ? "updated" : "pubDate") || xmlField(chunk, isAtom ? "published" : "dc:date"), 80),
      summary: limitedFeedText(xmlField(chunk, isAtom ? "summary" : "description") || xmlField(chunk, isAtom ? "content" : "content:encoded"), 1_200),
    };
  }).filter((item) => item.title);
  return items.length ? { url: feedUrl, title: feedTitle, source, items } : null;
}

function limitedFeedText(value: string, limit: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function atomLink(xml: string): string {
  const match = xml.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  return match?.[1] ? decodeEntities(match[1]) : "";
}

function xmlField(xml: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match?.[1] ? decodeEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()) : "";
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== "#") return named[code.toLocaleLowerCase()] || entity;
    const numeric = code[1]?.toLocaleLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    try { return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity; } catch { return entity; }
  });
}

function externalSource(value: string, fallback: string): string {
  try { return new URL(value).hostname.replace(/^www\./i, ""); }
  catch { return fallback; }
}
