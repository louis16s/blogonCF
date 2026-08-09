import type { PasswordRateLimitDatabase } from "./rate-limit";

export type FeedCacheEntry = { payload: string; updated_at: number; expires_at: number };

export async function readFeedCache(db: PasswordRateLimitDatabase | undefined, url: string): Promise<FeedCacheEntry | null> {
  if (!db) return null;
  try { return await db.prepare("SELECT payload, updated_at, expires_at FROM external_feed_cache WHERE url = ?1").bind(url).first<FeedCacheEntry>(); }
  catch { return null; }
}

export async function writeFeedCache(db: PasswordRateLimitDatabase | undefined, url: string, payload: string, now: number, expiresAt: number): Promise<void> {
  if (!db) return;
  try {
    await db.prepare("INSERT INTO external_feed_cache (url, payload, updated_at, expires_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(url) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, expires_at = excluded.expires_at")
      .bind(url, payload, now, expiresAt).run();
  } catch { /* A missing migration must not break the reader. */ }
}
