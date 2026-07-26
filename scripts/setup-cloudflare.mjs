import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const wranglerConfigPath = new URL("../wrangler.jsonc", import.meta.url);
const packageRunner = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const prompt = createInterface({ input: stdin, output: stdout });

function run(args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync(packageRunner, args, {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
  });
  if (!allowFailure && result.status !== 0) {
    if (capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(`命令执行失败：pnpm ${args.join(" ")}`);
  }
  return result;
}

function replaceJsonString(source, key, value) {
  const pattern = new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`);
  if (!pattern.test(source)) throw new Error(`wrangler.jsonc 中缺少 ${key}`);
  return source.replace(pattern, `$1${JSON.stringify(value)}`);
}

async function question(label, fallback = "") {
  const suffix = fallback ? `（默认 ${fallback}）` : "";
  const value = (await prompt.question(`${label}${suffix}：`)).trim();
  return value || fallback;
}

async function main() {
  if (!stdin.isTTY) throw new Error("请在交互式终端中运行 pnpm setup:cloudflare");

  console.log("\nblogonCF 初始化：只需填写 Notion 数据源，其他步骤会自动完成。\n");
  const workerName = await question("Worker 名称", "blogincf");
  const dataSourceId = await question("文章数据库 Data Source ID");
  if (!dataSourceId) throw new Error("文章数据库 Data Source ID 不能为空");
  const configDataSourceId = await question("配置中心 Data Source ID（没有可留空）");
  const databaseName = `${workerName}-rate-limit`;
  prompt.close();

  const whoami = run(["exec", "wrangler", "whoami"], { allowFailure: true });
  if (whoami.status !== 0) run(["exec", "wrangler", "login"]);

  const list = run(["exec", "wrangler", "d1", "list", "--json"], { capture: true });
  const databases = JSON.parse(list.stdout || "[]");
  let database = databases.find((item) => item.name === databaseName);
  if (!database) {
    const created = run(["exec", "wrangler", "d1", "create", databaseName], { capture: true });
    const output = `${created.stdout || ""}\n${created.stderr || ""}`;
    const id = output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
    if (!id) throw new Error("D1 已创建，但无法读取 database_id；请查看上方 Wrangler 输出");
    database = { uuid: id, name: databaseName };
  }

  let config = await readFile(wranglerConfigPath, "utf8");
  config = replaceJsonString(config, "name", workerName);
  config = replaceJsonString(config, "database_name", databaseName);
  config = replaceJsonString(config, "database_id", database.uuid);
  config = replaceJsonString(config, "NOTION_DATA_SOURCE_ID", dataSourceId);
  config = replaceJsonString(config, "NOTION_CONFIG_DATA_SOURCE_ID", configDataSourceId);
  await writeFile(wranglerConfigPath, config);

  run(["run", "build"]);
  run(["run", "deploy"]);

  console.log("\n最后一步：在 Wrangler 提示中粘贴 NOTION_TOKEN。输入不会显示。\n");
  run(["exec", "wrangler", "secret", "put", "NOTION_TOKEN", "--config", "wrangler.jsonc"]);

  console.log(`\n完成。Worker ${workerName} 已部署；请确保两个 Notion 数据库都已共享给同一个 Integration。\n`);
}

main().catch((error) => {
  prompt.close();
  console.error(`\n初始化失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
