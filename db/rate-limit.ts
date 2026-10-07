const PASSWORD_LIMIT = 5;
const PASSWORD_WINDOW_MS = 10 * 60 * 1000;

type RateLimitResult = { allowed: boolean; retryAfter: number };

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
};

export type PasswordRateLimitDatabase = { prepare(sql: string): D1Statement };

const EXPENSIVE_LIMIT_PREFIX = "expensive:";
const localRequestWindows = new Map<string, { windowStart: number; requestCount: number }>();

/**
 * Shared rate limit for costly cache-miss work. Hash the client address before
 * storing it so the rate-limit table does not retain raw IP addresses.
 */
export async function checkExpensiveRequest(
  db: PasswordRateLimitDatabase | undefined,
  request: Request,
  route: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
  hashSecret = "blogonCF-local-rate-limit",
): Promise<{ allowed: boolean; retryAfter: number; available: boolean }> {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "unknown";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(hashSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${route}:${ip}`));
  const hash = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const storageKey = `${EXPENSIVE_LIMIT_PREFIX}${hash}`;
  if (!db) {
    const current = localRequestWindows.get(storageKey);
    const entry = !current || current.windowStart <= now - windowMs
      ? { windowStart: now, requestCount: 1 }
      : { ...current, requestCount: current.requestCount + 1 };
    localRequestWindows.set(storageKey, entry);
    if (localRequestWindows.size > 2_000) {
      for (const [oldKey, oldValue] of localRequestWindows) if (oldValue.windowStart <= now - windowMs) localRequestWindows.delete(oldKey);
    }
    return { allowed: entry.requestCount <= limit, retryAfter: Math.max(1, Math.ceil((entry.windowStart + windowMs - now) / 1000)), available: true };
  }

  const cutoff = now - windowMs;
  try {
    const row = await db.prepare(`
      INSERT INTO request_rate_limits (key, window_start, request_count)
      VALUES (?1, ?2, 1)
      ON CONFLICT(key) DO UPDATE SET
        request_count = CASE WHEN request_rate_limits.window_start <= ?3 THEN 1 ELSE request_rate_limits.request_count + 1 END,
        window_start = CASE WHEN request_rate_limits.window_start <= ?3 THEN excluded.window_start ELSE request_rate_limits.window_start END
      RETURNING request_count, window_start
    `).bind(storageKey, now, cutoff).first<{ request_count: number; window_start: number }>();
    const count = row?.request_count ?? limit + 1;
    const windowStart = row?.window_start ?? now;
    return {
      allowed: count <= limit,
      retryAfter: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
      available: true,
    };
  } catch {
    return { allowed: false, retryAfter: 60, available: false };
  }
}

export async function cleanExpiredRequestLimits(db: PasswordRateLimitDatabase | undefined, now = Date.now()): Promise<void> {
  if (!db) return;
  try {
    await db.prepare("DELETE FROM request_rate_limits WHERE window_start <= ?1")
      .bind(now - 24 * 60 * 60 * 1000)
      .run();
  } catch { /* A missing migration must not break scheduled content refreshes. */ }
}

export async function getPasswordAttemptStatus(db: PasswordRateLimitDatabase, key: string, now = Date.now()): Promise<RateLimitResult> {
  const row = await db.prepare("SELECT attempt_count, window_start FROM password_attempts WHERE key = ?1")
    .bind(key)
    .first<{ attempt_count: number; window_start: number }>();
  if (!row || row.window_start <= now - PASSWORD_WINDOW_MS) return { allowed: true, retryAfter: 0 };
  return { allowed: row.attempt_count < PASSWORD_LIMIT, retryAfter: Math.max(1, Math.ceil((row.window_start + PASSWORD_WINDOW_MS - now) / 1000)) };
}

export async function recordPasswordFailure(db: PasswordRateLimitDatabase, key: string, now = Date.now()): Promise<RateLimitResult> {
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

export async function clearPasswordAttempts(db: PasswordRateLimitDatabase, key: string) {
  await db.prepare("DELETE FROM password_attempts WHERE key = ?1")
    .bind(key)
    .run();
}
