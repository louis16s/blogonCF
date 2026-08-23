import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const passwordAttempts = sqliteTable("password_attempts", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
});

export const externalFeedCache = sqliteTable("external_feed_cache", {
  url: text("url").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("external_feed_cache_expires_at_idx").on(table.expiresAt)]);

export const articleHeadingCache = sqliteTable("article_heading_cache", {
  pageId: text("page_id").primaryKey(),
  version: text("version").notNull(),
  headingsJson: text("headings_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const articleHeadingJobs = sqliteTable("article_heading_jobs", {
  pageId: text("page_id").primaryKey(),
  version: text("version").notNull(),
  queueJson: text("queue_json").notNull(),
  headingsJson: text("headings_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const contentIndex = sqliteTable("content_index", {
  pageId: text("page_id").primaryKey(),
  sourceKey: text("source_key").notNull(),
  lastEditedTime: text("last_edited_time").notNull().default(""),
  isPublic: integer("is_public").notNull().default(0),
  locked: integer("locked").notNull().default(0),
  postJson: text("post_json").notNull(),
  body: text("body").notNull().default(""),
  searchBody: text("search_body").notNull().default(""),
  partial: integer("partial").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("content_index_source_public_idx").on(table.sourceKey, table.isPublic),
  index("content_index_updated_at_idx").on(table.updatedAt),
]);

export const linkPreviewCache = sqliteTable("link_preview_cache", {
  url: text("url").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("link_preview_cache_expires_at_idx").on(table.expiresAt)]);
