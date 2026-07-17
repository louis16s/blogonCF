const PASSWORD_LIMIT = 5;
const PASSWORD_WINDOW_MS = 10 * 60 * 1000;

export type RateLimitResult = { allowed: boolean; retryAfter: number };

export async function consumePasswordAttempt(db: D1Database, key: string, now = Date.now()): Promise<RateLimitResult> {
  const windowStart = Math.floor(now / PASSWORD_WINDOW_MS) * PASSWORD_WINDOW_MS;
  const bucketKey = `${key}:${windowStart}`;
  const row = await db.prepare(`
    INSERT INTO password_attempts (key, window_start, attempt_count)
    VALUES (?1, ?2, 1)
    ON CONFLICT(key) DO UPDATE SET attempt_count = attempt_count + 1
    RETURNING attempt_count
  `).bind(bucketKey, windowStart).first<{ attempt_count: number }>();

  await db.prepare("DELETE FROM password_attempts WHERE window_start < ?1")
    .bind(windowStart - PASSWORD_WINDOW_MS)
    .run();

  const count = row?.attempt_count ?? PASSWORD_LIMIT + 1;
  return { allowed: count <= PASSWORD_LIMIT, retryAfter: Math.max(1, Math.ceil((windowStart + PASSWORD_WINDOW_MS - now) / 1000)) };
}

export async function clearPasswordAttempts(db: D1Database, key: string, now = Date.now()) {
  const windowStart = Math.floor(now / PASSWORD_WINDOW_MS) * PASSWORD_WINDOW_MS;
  await db.prepare("DELETE FROM password_attempts WHERE key = ?1")
    .bind(`${key}:${windowStart}`)
    .run();
}
