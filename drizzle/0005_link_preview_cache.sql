CREATE TABLE IF NOT EXISTS link_preview_cache (
  url TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS link_preview_cache_expires_at_idx
  ON link_preview_cache (expires_at);
