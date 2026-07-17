const PASSWORD_LIMIT = 5;
const PASSWORD_WINDOW_MS = 10 * 60 * 1000;

export type RateLimitResult = { allowed: boolean; retryAfter: number };

export async function consumePasswordAttempt(db: D1Database, key: string, now = Date.now()): Promise<RateLimitResult> {
  const cutoff = now - PASSWORD_WINDOW_MS;
  const row = await db.prepare(`
    INSERT INTO password_attempts (key, window_start, attempt_count)
    VALUES (?1, ?2, 1)
    ON CONFLICT(key) DO UPDATE SET
      attempt_count = CASE WHEN password_attempts.window_start <= ?3 THEN 1 ELSE password_attempts.attempt_count + 1 END,
      window_start = CASE WHEN password_attempts.window_start <= ?3 THEN excluded.window_start ELSE password_attempts.window_start END
    RETURNING attempt_count, window_start
  `).bind(key, now, cutoff).first<{ attempt_count: number; window_start: number }>();

  await db.prepare("DELETE FROM password_attempts WHERE window_start <= ?1 AND key <> ?2")
    .bind(cutoff, key)
    .run();

  const count = row?.attempt_count ?? PASSWORD_LIMIT + 1;
  const windowStart = row?.window_start ?? now;
  return { allowed: count <= PASSWORD_LIMIT, retryAfter: Math.max(1, Math.ceil((windowStart + PASSWORD_WINDOW_MS - now) / 1000)) };
}

export async function clearPasswordAttempts(db: D1Database, key: string) {
  await db.prepare("DELETE FROM password_attempts WHERE key = ?1")
    .bind(key)
    .run();
}
