import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function loadSync(rows) {
  const source = await readFile(new URL("../worker/content-index-sync.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const writes = [];
  const deleted = [];
  const modules = {
    "../db/content-index": {
      readContentIndexVersions: async () => [...rows.values()],
      readContentIndexVersionsForPages: async (_db, _key, ids) => ids.flatMap((id) => rows.has(id) ? [rows.get(id)] : []),
      readFailedContentIndexVersions: async () => [...rows.values()].filter((row) => row.retryable).slice(0, 20),
      writeContentIndex: async (_db, _key, id, version, document) => {
        writes.push(id);
        rows.set(id, { page_id: id, last_edited_time: version, locked: Number(document.locked), retryable: Number(document.partial && !document.body && !document.searchBody && !document.locked) });
      },
      deleteContentIndexPage: async (_db, id) => { deleted.push(id); rows.delete(id); },
    },
    "../db/content-sync-state": {
      readContentSyncState: async () => ({ cursor: new Date().toISOString(), last_full_sync_at: Date.now() }),
      writeContentSyncState: async () => {},
    },
    "./notion-client": { normalizeNotionId: () => "", plain: (property) => property?.rich_text?.map((item) => item.plain_text).join("") || "" },
  };
  const sandbox = { exports: {}, require: (name) => { assert.ok(modules[name], name); return modules[name]; }, Date, console };
  vm.runInNewContext(code, sandbox);
  return { refresh: sandbox.exports.refreshContentIndex, writes, deleted };
}

const version = "2026-10-13T00:00:00.000Z";
const page = (id) => ({ id, last_edited_time: version, properties: { type: { select: { name: "Post" } }, status: { select: { name: "Published" } }, password: { rich_text: [] } } });
const row = (id, retryable = 0) => ({ page_id: id, last_edited_time: version, locked: 0, retryable });
const recovered = { locked: false, body: "Recovered article", searchBody: "Recovered article", partial: false };

test("incremental refresh repairs an old failed empty index outside the edit window", async () => {
  const rows = new Map([["failed", row("failed", 1)], ["complete", row("complete")], ["truncated", row("truncated")]]);
  const { refresh, writes } = await loadSync(rows);
  const reads = [];
  const builds = [];
  const options = { db: {}, sourceKey: "test", queryChangedPages: async () => [], queryPublishedPosts: async () => { throw new Error("full query unnecessary"); }, queryPage: async (id) => { reads.push(id); return page(id); }, buildDocument: async (value) => { builds.push(value.id); return recovered; } };
  await refresh(options);
  await refresh(options);
  assert.deepEqual(reads, ["failed"]);
  assert.deepEqual(builds, ["failed"]);
  assert.deepEqual(writes, ["failed"]);
});

test("full reconciliation retries failed rows but skips unchanged complete and truncated content", async () => {
  const rows = new Map([["failed", row("failed", 1)], ["complete", row("complete")], ["truncated", row("truncated")]]);
  const { refresh, writes } = await loadSync(rows);
  await refresh({ db: {}, sourceKey: "test", forceFullReconciliation: true, queryChangedPages: async () => [], queryPublishedPosts: async () => [page("failed"), page("complete"), page("truncated")], buildDocument: async () => recovered });
  assert.deepEqual(writes, ["failed"]);
});

test("failed retry rows are removed when their Notion page is archived", async () => {
  const { refresh, writes, deleted } = await loadSync(new Map([["failed", row("failed", 1)]]));
  await refresh({ db: {}, sourceKey: "test", queryChangedPages: async () => [], queryPublishedPosts: async () => [], queryPage: async () => ({ ...page("failed"), archived: true }), buildDocument: async () => recovered });
  assert.deepEqual(writes, []);
  assert.deepEqual(deleted, ["failed"]);
});

test("retry queries exclude nonempty truncated articles and bound repair work", async () => {
  const source = await readFile(new URL("../db/content-index.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { exports: {} };
  vm.runInNewContext(code, sandbox);
  const queries = [];
  const db = { prepare(sql) { queries.push(sql); return { bind() { return this; }, async all() { return { results: [] }; } }; } };
  await sandbox.exports.readFailedContentIndexVersions(db, "source");
  await sandbox.exports.readContentIndexVersions(db, "source");
  await sandbox.exports.readContentIndexVersionsForPages(db, "source", ["page"]);
  for (const sql of queries) {
    assert.match(sql, /partial = 1 AND body = '' AND search_body = '' AND is_public = 1/);
  }
  assert.match(queries[0], /ORDER BY updated_at ASC LIMIT 20/);
});
