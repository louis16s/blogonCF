CREATE TABLE IF NOT EXISTS content_index (
  page_id TEXT PRIMARY KEY NOT NULL,
  source_key TEXT NOT NULL,
  last_edited_time TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  post_json TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  search_body TEXT NOT NULL DEFAULT '',
  partial INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS content_index_source_public_idx
  ON content_index (source_key, is_public);

CREATE INDEX IF NOT EXISTS content_index_updated_at_idx
  ON content_index (updated_at);
