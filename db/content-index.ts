import type { PasswordRateLimitDatabase } from "./rate-limit";

/**
 * Durable, public-only search index. Notion remains the source of truth; D1
 * stores the last normalized projection so user requests do not traverse the
 * Notion block tree. Private article bodies are deliberately never persisted.
 */
export type IndexedContentDocument = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  category: string;
  tags: string[];
  date: string;
  icon: string;
  locked: boolean;
  body: string;
  searchBody: string;
  partial: boolean;
};

type ContentIndexVersion = { page_id: string; last_edited_time: string; locked: number };

type AllCapableStatement = { all<T>(): Promise<{ results?: T[] }> };

function all<T>(db: PasswordRateLimitDatabase, sql: string, ...values: unknown[]): Promise<T[]> {
  const statement = db.prepare(sql).bind(...values) as unknown as Partial<AllCapableStatement>;
  if (typeof statement.all !== "function") throw new Error("D1 statement does not support all()");
  return statement.all<T>().then((result) => Array.isArray(result?.results) ? result.results : []);
}

export async function readContentIndex(db: PasswordRateLimitDatabase | undefined, sourceKey: string): Promise<IndexedContentDocument[]> {
  if (!db) return [];
  const rows = await all<{ post_json: string; body: string; search_body: string; partial: number }>(db,
    "SELECT post_json, body, search_body, partial FROM content_index WHERE source_key = ?1 AND is_public = 1",
    sourceKey,
  );
  return rows.flatMap((row) => {
    try {
      const post = JSON.parse(row.post_json) as Omit<IndexedContentDocument, "body" | "searchBody" | "partial">;
      if (!post || typeof post.id !== "string" || typeof post.title !== "string") return [];
      return [{ ...post, body: row.body || "", searchBody: row.search_body || "", partial: Boolean(row.partial) }];
    } catch { return []; }
  });
}

export async function hasContentIndex(db: PasswordRateLimitDatabase | undefined, sourceKey: string): Promise<boolean> {
  if (!db) return false;
  const row = await db.prepare("SELECT page_id FROM content_index WHERE source_key = ?1 LIMIT 1").bind(sourceKey).first<{ page_id?: string }>();
  return typeof row?.page_id === "string" && row.page_id.length > 0;
}

export async function readContentIndexVersions(db: PasswordRateLimitDatabase | undefined, sourceKey: string): Promise<ContentIndexVersion[]> {
  if (!db) return [];
  return all<ContentIndexVersion>(db,
    "SELECT page_id, last_edited_time, locked FROM content_index WHERE source_key = ?1",
    sourceKey,
  );
}

export async function writeContentIndex(
  db: PasswordRateLimitDatabase | undefined,
  sourceKey: string,
  pageId: string,
  lastEditedTime: string,
  document: IndexedContentDocument,
): Promise<void> {
  if (!db) return;
  const post = { ...document };
  delete (post as Partial<IndexedContentDocument>).body;
  delete (post as Partial<IndexedContentDocument>).searchBody;
  delete (post as Partial<IndexedContentDocument>).partial;
  await db.prepare(`
      INSERT INTO content_index
        (page_id, source_key, last_edited_time, is_public, locked, post_json, body, search_body, partial, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
      ON CONFLICT(page_id) DO UPDATE SET
        source_key = excluded.source_key,
        last_edited_time = excluded.last_edited_time,
        is_public = excluded.is_public,
        locked = excluded.locked,
        post_json = excluded.post_json,
        body = excluded.body,
        search_body = excluded.search_body,
        partial = excluded.partial,
        updated_at = excluded.updated_at
    `).bind(
      pageId,
      sourceKey,
      lastEditedTime,
      document.locked ? 0 : 1,
      document.locked ? 1 : 0,
      JSON.stringify(post),
      document.locked ? "" : document.body,
      document.locked ? "" : document.searchBody,
      document.locked ? 0 : (document.partial ? 1 : 0),
      Date.now(),
    ).run();
}

export async function deleteContentIndexPage(db: PasswordRateLimitDatabase | undefined, pageId: string): Promise<void> {
  if (!db) return;
  await db.prepare("DELETE FROM content_index WHERE page_id = ?1").bind(pageId).run();
}
