import { spawnSync } from "node:child_process";
import { auditExceptions, evaluateAuditReport, parseAuditExecution } from "./audit-policy.mjs";

const audit = spawnSync("pnpm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
let report;
try { report = parseAuditExecution(audit); }
catch (reason) {
  console.error(reason instanceof Error ? reason.message : "Dependency audit failed");
  process.exit(1);
}

const failures = evaluateAuditReport(report);

if (failures.length) {
  console.error(`Unapproved dependency vulnerabilities:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`Dependency audit passed; ${auditExceptions.size} build-only advisory exceptions expire on or before 2026-12-31.`);
