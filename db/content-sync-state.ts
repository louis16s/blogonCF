import type { PasswordRateLimitDatabase } from "./rate-limit";

export type ContentSyncState = { cursor: string; last_full_sync_at: number };

export async function readContentSyncState(
  db: PasswordRateLimitDatabase | undefined,
  sourceKey: string,
): Promise<ContentSyncState | null> {
  if (!db) return null;
  return db.prepare("SELECT cursor, last_full_sync_at FROM content_sync_state WHERE source_key = ?1")
    .bind(sourceKey)
    .first<ContentSyncState>();
}

export async function writeContentSyncState(
  db: PasswordRateLimitDatabase | undefined,
  sourceKey: string,
  cursor: string,
  fullSync = false,
): Promise<void> {
  if (!db) return;
  const now = Date.now();
  await db.prepare(`
    INSERT INTO content_sync_state (source_key, cursor, last_full_sync_at, updated_at)
    VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(source_key) DO UPDATE SET
      cursor = excluded.cursor,
      last_full_sync_at = CASE WHEN ?5 = 1 THEN excluded.last_full_sync_at ELSE content_sync_state.last_full_sync_at END,
      updated_at = excluded.updated_at
  `).bind(sourceKey, cursor, fullSync ? now : 0, now, fullSync ? 1 : 0).run();
}
