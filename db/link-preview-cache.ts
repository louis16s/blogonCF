import type { PasswordRateLimitDatabase } from "./rate-limit";

export type LinkPreviewCacheEntry = { payload: string; updated_at: number; expires_at: number };

export async function readLinkPreviewCache(db: PasswordRateLimitDatabase | undefined, url: string): Promise<LinkPreviewCacheEntry | null> {
  if (!db) return null;
  try {
    return await db.prepare("SELECT payload, updated_at, expires_at FROM link_preview_cache WHERE url = ?1").bind(url).first<LinkPreviewCacheEntry>();
  } catch { return null; }
}

export async function writeLinkPreviewCache(db: PasswordRateLimitDatabase | undefined, url: string, payload: string, now: number, expiresAt: number): Promise<void> {
  if (!db) return;
  try {
    await db.prepare(`
      INSERT INTO link_preview_cache (url, payload, updated_at, expires_at)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(url) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `).bind(url, payload, now, expiresAt).run();
  } catch { /* Preview caching is best effort. */ }
}

