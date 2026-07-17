import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const passwordAttempts = sqliteTable("password_attempts", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
});
