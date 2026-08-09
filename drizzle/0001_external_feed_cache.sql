CREATE TABLE IF NOT EXISTS external_feed_cache (
  url TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS external_feed_cache_expires_at_idx ON external_feed_cache (expires_at);
