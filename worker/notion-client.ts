/** Typed, bounded access to the Notion API. */
/* eslint-disable @typescript-eslint/no-explicit-any -- Notion responses are normalized at the gateway boundary. */

export const NOTION_VERSION = "2026-03-11";

const NOTION_REQUEST_TIMEOUT_MS = 8_000;
const NOTION_MAX_ATTEMPTS = 2;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export type NotionEnvironment = { NOTION_TOKEN?: string };

export async function notionFetch(env: NotionEnvironment, path: string, init: RequestInit = {}): Promise<any> {
  if (!env.NOTION_TOKEN) throw new Error("Notion connection is not configured");

  for (let attempt = 0; attempt < NOTION_MAX_ATTEMPTS; attempt++) {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${env.NOTION_TOKEN}`);
    headers.set("notion-version", NOTION_VERSION);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    const timeout = AbortSignal.timeout(NOTION_REQUEST_TIMEOUT_MS);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

    try {
      const response = await fetch(`https://api.notion.com/v1${path}`, { ...init, headers: Object.fromEntries(headers), signal });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      if (!RETRYABLE_STATUS.has(response.status) || attempt === NOTION_MAX_ATTEMPTS - 1) {
        throw new Error(`Notion ${response.status}: ${safeNotionMessage(payload)}`);
      }
      await waitBeforeRetry(response.headers.get("retry-after"), attempt);
    } catch (reason) {
      if (init.signal?.aborted) throw reason;
      if (reason instanceof Error && reason.message.startsWith("Notion ")) throw reason;
      if (attempt === NOTION_MAX_ATTEMPTS - 1) {
        if (reason instanceof DOMException && reason.name === "TimeoutError") throw new Error("Notion request timed out");
        throw reason;
      }
      await waitBeforeRetry(null, attempt);
    }
  }
  throw new Error("Notion request failed after retries");
}

export function normalizeNotionId(value: unknown): string {
  if (typeof value !== "string") return "";
  const compact = value.replaceAll("-", "").toLocaleLowerCase();
  if (!/^[a-f0-9]{32}$/.test(compact)) return "";
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

export function normalizeNotionCursor(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) return "";
  return value;
}

export function richText(value: any): string {
  return Array.isArray(value)
    ? value.map((item) => item?.plain_text || item?.text?.content || "").join("")
    : typeof value === "string" ? value : "";
}

export function title(property: any): string {
  return richText(property?.title);
}

export function plain(property: any): string {
  return richText(property?.rich_text || property?.title || property);
}

function safeNotionMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "request failed";
  const message = (payload as { message?: unknown }).message;
  return typeof message === "string" ? message.replace(/[\r\n\u0000-\u001f\u007f]+/g, " ").slice(0, 240) : "request failed";
}

async function waitBeforeRetry(retryAfter: string | null, attempt: number): Promise<void> {
  let delay = 300 * (2 ** attempt) + Math.floor(Math.random() * 120);
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(seconds)) delay = Math.max(0, seconds * 1000);
    else if (Number.isFinite(dateDelay)) delay = Math.max(0, dateDelay);
  }
  await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 3_000)));
}
