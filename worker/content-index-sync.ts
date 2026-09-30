/**
 * Coordinates the durable public-content index refresh independently from
 * request routing. Notion block parsing stays in the Worker adapter so this
 * module owns only cursor/reconciliation behavior and D1 writes.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- raw Notion rows enter through the gateway boundary. */
import {
  deleteContentIndexPage,
  readContentIndexVersions,
  readContentIndexVersionsForPages,
  writeContentIndex,
  type IndexedContentDocument,
} from "../db/content-index";
import { readContentSyncState, writeContentSyncState } from "../db/content-sync-state";
import type { PasswordRateLimitDatabase } from "../db/rate-limit";
import { normalizeNotionId, plain } from "./notion-client";

export const CONTENT_FULL_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const CONTENT_REFRESH_CRON = "*/15 * * * *";
const CONTENT_SYNC_OVERLAP_MS = 5 * 60 * 1000;

export function scheduledRefreshTasks(scheduledTime: number): { reconcile: boolean; refreshFeeds: boolean } {
  const time = new Date(scheduledTime);
  return {
    reconcile: time.getUTCHours() === 3 && time.getUTCMinutes() === 15,
    refreshFeeds: time.getUTCMinutes() === 0,
  };
}

type ExistingVersion = { last_edited_time: string; locked: number };

export async function refreshContentIndex(options: {
  db: PasswordRateLimitDatabase;
  sourceKey: string;
  forceFullReconciliation?: boolean;
  queryPublishedPosts: () => Promise<any[]>;
  queryChangedPages: (editedAfter: string) => Promise<any[]>;
  buildDocument: (page: any) => Promise<IndexedContentDocument>;
}): Promise<void> {
  const { db, sourceKey, forceFullReconciliation = false } = options;
  try {
    const prior = await readContentSyncState(db, sourceKey);
    const fullSyncDue = !prior?.last_full_sync_at
      || Date.now() - prior.last_full_sync_at >= CONTENT_FULL_RECONCILIATION_INTERVAL_MS;
    const fullReconciliation = forceFullReconciliation || fullSyncDue || !prior?.cursor || !Number.isFinite(Date.parse(prior.cursor));
    const syncStartedAt = new Date().toISOString();

    if (fullReconciliation) {
      const pages = await options.queryPublishedPosts();
      const versions = new Map((await readContentIndexVersions(db, sourceKey)).map((row) => [row.page_id, row]));
      const currentIds = new Set<string>();
      for (const page of pages) {
        const pageId = normalizeNotionId(page.id) || page.id;
        if (typeof pageId !== "string" || !pageId) continue;
        currentIds.add(pageId);
        await indexPageIfChanged(db, sourceKey, page, versions.get(pageId), options.buildDocument);
      }
      for (const pageId of versions.keys()) {
        if (!currentIds.has(pageId)) await deleteContentIndexPage(db, pageId);
      }
    } else {
      const editedAfter = new Date(Math.max(0, Date.parse(prior.cursor) - CONTENT_SYNC_OVERLAP_MS)).toISOString();
      const changedPages = await options.queryChangedPages(editedAfter);
      const pageIds = changedPages.map((page) => normalizeNotionId(page.id) || page.id).filter((id): id is string => typeof id === "string" && Boolean(id));
      const versions = new Map((await readContentIndexVersionsForPages(db, sourceKey, pageIds)).map((row) => [row.page_id, row]));
      for (const page of changedPages) {
        const pageId = normalizeNotionId(page.id) || page.id;
        if (typeof pageId !== "string" || !pageId) continue;
        const publishedPost = selectValue(page.properties?.type) === "Post" && selectValue(page.properties?.status) === "Published";
        if (!publishedPost) {
          if (versions.has(pageId)) await deleteContentIndexPage(db, pageId);
          continue;
        }
        await indexPageIfChanged(db, sourceKey, page, versions.get(pageId), options.buildDocument);
      }
    }

    // Advance only after each page and removal completed. The overlap makes
    // boundary edits idempotently visible on the following run.
    await writeContentSyncState(db, sourceKey, syncStartedAt, fullReconciliation);
  } catch (reason) {
    console.warn(JSON.stringify({ event: "content-index-refresh-failed", message: reason instanceof Error ? reason.message : String(reason) }));
  }
}

function selectValue(property: any): string {
  return typeof property?.select?.name === "string" ? property.select.name : "";
}

async function indexPageIfChanged(
  db: PasswordRateLimitDatabase,
  sourceKey: string,
  page: any,
  existing: ExistingVersion | undefined,
  buildDocument: (page: any) => Promise<IndexedContentDocument>,
): Promise<void> {
  const pageId = normalizeNotionId(page.id) || page.id;
  const lastEdited = typeof page.last_edited_time === "string" ? page.last_edited_time : "";
  const locked = Boolean(plain(page.properties?.password));
  if (existing && existing.last_edited_time === lastEdited && Boolean(existing.locked) === locked) return;
  try {
    const document = await buildDocument(page);
    await writeContentIndex(db, sourceKey, pageId, lastEdited, document);
  } catch (reason) {
    console.warn(JSON.stringify({ event: "content-index-page-failed", pageId, message: reason instanceof Error ? reason.message : String(reason) }));
    throw reason;
  }
}
