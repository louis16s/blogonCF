import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { configureWranglerTemplate } from "../scripts/setup-cloudflare.mjs";

const root = new URL("../", import.meta.url);

test("replication uses one package manager and exposes a guided Cloudflare setup", async () => {
  const [packageSource, readme, setupSource, wranglerSource] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("scripts/setup-cloudflare.mjs", root), "utf8"),
    readFile(new URL("wrangler.jsonc", root), "utf8"),
  ]);
  const manifest = JSON.parse(packageSource);

  assert.match(manifest.packageManager, /^pnpm@/);
  assert.equal(manifest.scripts.deploy, "pnpm run deploy:worker");
  assert.equal(manifest.scripts.release, "pnpm run build && pnpm run deploy:worker");
  assert.equal(manifest.scripts.typecheck, "tsc --noEmit --incremental false");
  assert.equal(manifest.scripts["setup:cloudflare"], "node scripts/setup-cloudflare.mjs");
  await assert.rejects(access(new URL("package-lock.json", root)));

  assert.match(readme, /deploy\.workers\.cloudflare\.com\/\?url=https%3A%2F%2Fgithub\.com%2Flouis16s%2FblogonCF\.git/);
  assert.match(readme, /pnpm create cloudflare@latest my-blog --template github:louis16s\/blogonCF --template-mode tar/);
  assert.match(setupSource, /"d1", "list", "--json"/);
  assert.match(setupSource, /"d1", "create", databaseName/);
  assert.match(setupSource, /configureWranglerTemplate/);
  assert.match(setupSource, /"secret", "put", "NOTION_TOKEN"/);
  assert.doesNotMatch(wranglerSource, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, "the public template must not contain an author's D1 resource ID");
  assert.doesNotMatch(wranglerSource, /530555|fffad771/i, "the public template must not contain an author's domain or Notion data source");
  assert.doesNotMatch(wranglerSource, /"no_bundle"|"rules"/, "Vinext/Vite-ignored Wrangler options should not be shipped");

  const generated = configureWranglerTemplate(wranglerSource, {
    workerName: "fresh-blog",
    databaseName: "fresh-blog-db",
    databaseId: "11111111-1111-4111-8111-111111111111",
    siteUrl: "https://blog.example.com",
    dataSourceId: "22222222-2222-4222-8222-222222222222",
    configDataSourceId: "",
  });
  assert.match(generated, /"name": "fresh-blog"/);
  assert.match(generated, /"database_id": "11111111-1111-4111-8111-111111111111"/);
  assert.match(generated, /"NOTION_DATA_SOURCE_ID": "22222222-2222-4222-8222-222222222222"/);
  assert.throws(() => configureWranglerTemplate(wranglerSource, {
    workerName: "broken", databaseName: "broken", databaseId: "11111111-1111-4111-8111-111111111111", siteUrl: "", dataSourceId: "", configDataSourceId: "",
  }), /不能为空/);
});
