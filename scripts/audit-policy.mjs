export const auditExceptions = new Map([
  ["GHSA-67mh-4wv8-2f99", { package: "esbuild", expires: "2026-12-31" }],
  ["GHSA-f88m-g3jw-g9cj", { package: "sharp", expires: "2026-12-31" }],
  ["GHSA-w3rx-r6r6-pgpr", { package: "image-size", expires: "2026-12-31" }],
  ["GHSA-5p2g-fcmc-qvqq", { package: "image-size", expires: "2026-12-31" }],
]);

export function parseAuditExecution(execution) {
  if (execution.error) throw new Error(`Dependency audit could not start: ${execution.error.message}`);
  if (execution.signal) throw new Error(`Dependency audit was terminated by ${execution.signal}`);
  if (!Number.isInteger(execution.status)) throw new Error("Dependency audit did not return an exit status");
  if (typeof execution.stdout !== "string" || !execution.stdout.trim()) {
    throw new Error(execution.stderr?.trim() || "Dependency audit returned no report");
  }
  let report;
  try { report = JSON.parse(execution.stdout); }
  catch { throw new Error(execution.stderr?.trim() || "Dependency audit did not return valid JSON"); }
  if (report?.error) throw new Error(`Dependency audit failed: ${report.error.summary || report.error.message || "unknown error"}`);
  if (!report || typeof report !== "object" || Array.isArray(report)
    || !report.advisories || typeof report.advisories !== "object" || Array.isArray(report.advisories)
    || !report.metadata?.vulnerabilities || typeof report.metadata.vulnerabilities !== "object") {
    throw new Error("Dependency audit report has an unexpected schema");
  }
  const advisoryCount = Object.keys(report.advisories).length;
  if (execution.status !== 0 && !(execution.status === 1 && advisoryCount > 0)) {
    throw new Error(`Dependency audit exited with status ${execution.status}`);
  }
  return report;
}

export function evaluateAuditReport(report, today = new Date().toISOString().slice(0, 10)) {
  const failures = [];
  for (const advisory of Object.values(report.advisories)) {
    if (!["high", "critical"].includes(advisory.severity)) continue;
    const id = String(advisory.url || "").split("/").at(-1);
    const exception = auditExceptions.get(id);
    if (!exception || exception.package !== advisory.module_name || exception.expires < today) {
      failures.push(`${advisory.severity.toUpperCase()} ${advisory.module_name}: ${id || advisory.title}`);
    }
  }
  return failures;
}
