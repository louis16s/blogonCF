import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAuditReport, parseAuditExecution } from "../scripts/audit-policy.mjs";

const report = (advisories = {}) => ({ advisories, metadata: { vulnerabilities: { high: 0, critical: 0 } } });
const execution = (value, status = 0) => ({ status, signal: null, stdout: JSON.stringify(value), stderr: "" });

test("dependency audit policy fails closed on execution and report errors", () => {
  assert.throws(() => parseAuditExecution({ error: new Error("ENOENT"), status: null, signal: null, stdout: "", stderr: "" }), /could not start/);
  assert.throws(() => parseAuditExecution({ status: 2, signal: null, stdout: "", stderr: "network unavailable" }), /network unavailable/);
  assert.throws(() => parseAuditExecution(execution({ error: { summary: "registry unavailable" } }, 1)), /registry unavailable/);
  assert.throws(() => parseAuditExecution(execution({}, 0)), /unexpected schema/);
  assert.throws(() => parseAuditExecution(execution(report(), 2)), /status 2/);
});

test("dependency audit policy accepts only matching, unexpired advisory exceptions", () => {
  const accepted = report({ 1: { severity: "high", module_name: "sharp", url: "https://github.com/advisories/GHSA-f88m-g3jw-g9cj" } });
  assert.deepEqual(parseAuditExecution(execution(accepted, 1)), accepted);
  assert.deepEqual(evaluateAuditReport(accepted, "2026-08-31"), []);
  assert.deepEqual(evaluateAuditReport(accepted, "2027-01-01"), ["HIGH sharp: GHSA-f88m-g3jw-g9cj"]);
  const unknown = report({ 1: { severity: "critical", module_name: "runtime-package", url: "https://github.com/advisories/GHSA-unknown" } });
  assert.deepEqual(evaluateAuditReport(unknown), ["CRITICAL runtime-package: GHSA-unknown"]);
});
