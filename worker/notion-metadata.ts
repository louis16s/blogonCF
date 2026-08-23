/** Coalesced page metadata reads for child-page titles and emoji. */
/* eslint-disable @typescript-eslint/no-explicit-any -- Raw pages stay inside the Notion gateway. */

import { normalizeNotionCursor, normalizeNotionId, notionFetch, type NotionEnvironment } from "./notion-client";

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const pageCache = new Map<string, { expiresAt: number; page: any | null }>();

export async function readNotionPageMetadata(env: NotionEnvironment, pageIds: string[]): Promise<Map<string, any | null>> {
  const requested = [...new Set(pageIds.map(normalizeNotionId).filter(Boolean))];
  const result = new Map<string, any | null>();
  const missing: string[] = [];
  const now = Date.now();

  for (const pageId of requested) {
    const cached = pageCache.get(pageId);
    if (cached && cached.expiresAt > now) result.set(pageId, cached.page);
    else missing.push(pageId);
  }

  if (missing.length >= 3) await fillFromSearch(env, new Set(missing), result);
  const unresolved = missing.filter((pageId) => !result.has(pageId));
  await mapWithConcurrency(unresolved, 2, async (pageId) => {
    try { result.set(pageId, await notionFetch(env, `/pages/${pageId}`)); }
    catch { result.set(pageId, null); }
  });

  for (const pageId of missing) remember(pageId, result.get(pageId) || null);
  return result;
}

async function fillFromSearch(env: NotionEnvironment, wanted: Set<string>, result: Map<string, any | null>): Promise<void> {
  let cursor = "";
  for (let page = 0; page < 5 && wanted.size; page++) {
    const payload = await notionFetch(env, "/search", {
      method: "POST",
      body: JSON.stringify({
        filter: { property: "object", value: "page" },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    }).catch(() => null);
    if (!payload) return;
    for (const item of payload.results || []) {
      const pageId = normalizeNotionId(item?.id);
      if (wanted.delete(pageId)) result.set(pageId, item);
    }
    cursor = payload.has_more ? normalizeNotionCursor(payload.next_cursor) : "";
    if (!cursor) return;
  }
}

function remember(pageId: string, page: any | null): void {
  pageCache.delete(pageId);
  pageCache.set(pageId, { page, expiresAt: Date.now() + CACHE_TTL_MS });
  while (pageCache.size > MAX_CACHE_ENTRIES) {
    const oldest = pageCache.keys().next().value;
    if (oldest === undefined) break;
    pageCache.delete(oldest);
  }
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, mapper: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < items.length) await mapper(items[nextIndex++]);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}
