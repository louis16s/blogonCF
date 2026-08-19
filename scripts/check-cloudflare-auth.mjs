import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(command, ["wrangler", "whoami", "--config", "wrangler.jsonc"], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const output = `${result.stdout || ""}${result.stderr || ""}`;
process.stdout.write(output);

if (result.error || result.status !== 0 || /not authenticated|invalid request headers|invalid format for authorization/i.test(output)) {
  console.error("Cloudflare authentication is unavailable. Run `pnpm wrangler login` or set a valid CLOUDFLARE_API_TOKEN before deploying.");
  process.exit(1);
}
