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

test("unpatched braces exception is limited to trusted build paths", () => {
  const advisory = { severity: "high", module_name: "braces", url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
    findings: [{ version: "3.0.3", dev: true, paths: [".>vinext>vite-plugin-commonjs>vite-plugin-dynamic-import>fast-glob>micromatch>braces"] }] };
  assert.deepEqual(evaluateAuditReport(report({ 1: advisory }), "2026-10-13"), []);
  assert.equal(evaluateAuditReport(report({ 1: advisory }), "2026-11-14").length, 1);
  assert.equal(evaluateAuditReport(report({ 1: { ...advisory, findings: [{ ...advisory.findings[0], dev: false }] } }), "2026-10-13").length, 1);
  assert.equal(evaluateAuditReport(report({ 1: { ...advisory, findings: [{ ...advisory.findings[0], paths: [".>runtime>braces"] }] } }), "2026-10-13").length, 1);
  const legacy = { version: "3.0.3", paths: [". > vinext@0.0.50 > vite-plugin-commonjs@0.10.4 > vite-plugin-dynamic-import@1.6.0 > fast-glob@3.3.3 > micromatch@4.0.8 > braces@3.0.3"] };
  assert.deepEqual(evaluateAuditReport(report({ 1: { ...advisory, findings: [legacy] } }), "2026-10-13"), []);
  assert.equal(evaluateAuditReport(report({ 1: { ...advisory, findings: [{ ...legacy, dev: false }] } }), "2026-10-13").length, 1);
  assert.equal(evaluateAuditReport(report({ 1: { ...advisory, findings: [{ ...legacy, paths: [legacy.paths[0].replace("0.0.50", "0.0.51")] }] } }), "2026-10-13").length, 1);
});
