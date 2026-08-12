import type { PasswordRateLimitDatabase } from "./rate-limit";

export type CachedHeading = { id: string; label: string; level: number };
export type HeadingIndexTask =
  | { kind: "page"; parentId: string; cursor: string; depth: number }
  | { kind: "heading"; heading: CachedHeading };
export type HeadingIndexJob = { queue: HeadingIndexTask[]; headings: CachedHeading[] };

export async function readHeadingCache(db: PasswordRateLimitDatabase, pageId: string, version: string): Promise<CachedHeading[] | null> {
  try {
    const row = await db.prepare("SELECT headings_json FROM article_heading_cache WHERE page_id = ?1 AND version = ?2")
      .bind(pageId, version)
      .first<{ headings_json?: string }>();
    if (typeof row?.headings_json !== "string") return null;
    const parsed = JSON.parse(row.headings_json);
    return Array.isArray(parsed) && parsed.every(isCachedHeading) ? parsed : null;
  } catch {
    // The table may not exist during a rolling deployment. A cache miss must
    // never stop Notion content from rendering.
    return null;
  }
}

export async function writeHeadingCache(db: PasswordRateLimitDatabase, pageId: string, version: string, headings: CachedHeading[]): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO article_heading_cache (page_id, version, headings_json, updated_at)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(page_id) DO UPDATE SET
        version = excluded.version,
        headings_json = excluded.headings_json,
        updated_at = excluded.updated_at
    `).bind(pageId, version, JSON.stringify(headings), Date.now()).run();
  } catch {
    // In-memory caching remains available if D1 is temporarily unavailable.
  }
}

export async function readHeadingJob(db: PasswordRateLimitDatabase, pageId: string, version: string): Promise<HeadingIndexJob | null> {
  try {
    const row = await db.prepare("SELECT queue_json, headings_json FROM article_heading_jobs WHERE page_id = ?1 AND version = ?2")
      .bind(pageId, version)
      .first<{ queue_json?: string; headings_json?: string }>();
    if (typeof row?.queue_json !== "string" || typeof row.headings_json !== "string") return null;
    const queue = JSON.parse(row.queue_json);
    const headings = JSON.parse(row.headings_json);
    return Array.isArray(queue) && Array.isArray(headings) && headings.every(isCachedHeading) ? { queue, headings } : null;
  } catch { return null; }
}

export async function writeHeadingJob(db: PasswordRateLimitDatabase, pageId: string, version: string, job: HeadingIndexJob): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO article_heading_jobs (page_id, version, queue_json, headings_json, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(page_id) DO UPDATE SET
        version = excluded.version,
        queue_json = excluded.queue_json,
        headings_json = excluded.headings_json,
        updated_at = excluded.updated_at
    `).bind(pageId, version, JSON.stringify(job.queue), JSON.stringify(job.headings), Date.now()).run();
  } catch {}
}

export async function deleteHeadingJob(db: PasswordRateLimitDatabase, pageId: string): Promise<void> {
  try { await db.prepare("DELETE FROM article_heading_jobs WHERE page_id = ?1").bind(pageId).run(); }
  catch {}
}

function isCachedHeading(value: unknown): value is CachedHeading {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CachedHeading>;
  return typeof item.id === "string" && typeof item.label === "string" && [1, 2, 3].includes(item.level || 0);
}
