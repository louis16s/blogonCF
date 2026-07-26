import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("replication uses one package manager and exposes a guided Cloudflare setup", async () => {
  const [packageSource, readme, setupSource] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("scripts/setup-cloudflare.mjs", root), "utf8"),
  ]);
  const manifest = JSON.parse(packageSource);

  assert.match(manifest.packageManager, /^pnpm@/);
  assert.equal(manifest.scripts.deploy, "pnpm run deploy:worker");
  assert.equal(manifest.scripts.release, "pnpm run build && pnpm run deploy:worker");
  assert.equal(manifest.scripts["setup:cloudflare"], "node scripts/setup-cloudflare.mjs");
  await assert.rejects(access(new URL("package-lock.json", root)));

  assert.match(readme, /deploy\.workers\.cloudflare\.com\/\?url=https%3A%2F%2Fgithub\.com%2Flouis16s%2FblogonCF\.git/);
  assert.match(readme, /pnpm create cloudflare@latest my-blog --template github:louis16s\/blogonCF --template-mode tar/);
  assert.match(setupSource, /"d1", "list", "--json"/);
  assert.match(setupSource, /"d1", "create", databaseName/);
  assert.match(setupSource, /"secret", "put", "NOTION_TOKEN"/);
});
