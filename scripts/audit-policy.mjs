export const auditExceptions = new Map([
  ["GHSA-67mh-4wv8-2f99", { package: "esbuild", expires: "2026-12-31" }],
  ["GHSA-f88m-g3jw-g9cj", { package: "sharp", expires: "2026-12-31" }],
  // No patched braces release exists. Only our trusted-source lint/build glob
  // paths qualify; a runtime use or a different dependency path must fail CI.
  ["GHSA-vfj7-8cjw-p6xm", {
    package: "braces", expires: "2026-11-13", version: "3.0.3",
    allowedPaths: new Set([
      ".>eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces",
      ".>vinext>vite-plugin-commonjs>vite-plugin-dynamic-import>fast-glob>micromatch>braces",
    ]),
    // pnpm 9 reports exact versioned paths but omits finding.dev; only these
    // two known developer-tool chains qualify under that older report schema.
    legacyAllowedPaths: new Set([
      ". > eslint-config-next@16.3.8 > @next/eslint-plugin-next@16.3.8 > fast-glob@3.3.1 > micromatch@4.0.8 > braces@3.0.3",
      ". > vinext@0.0.50 > vite-plugin-commonjs@0.10.4 > vite-plugin-dynamic-import@1.6.0 > fast-glob@3.3.3 > micromatch@4.0.8 > braces@3.0.3",
    ]),
  }],
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
    const scopedFindingsMatch = !exception?.allowedPaths || (
      Array.isArray(advisory.findings) && advisory.findings.length > 0
      && advisory.findings.every((finding) => finding.version === exception.version
        && Array.isArray(finding.paths) && finding.paths.length > 0
        && ((finding.dev === true && finding.paths.every((path) => exception.allowedPaths.has(path)))
          || (finding.dev === undefined && finding.paths.every((path) => exception.legacyAllowedPaths.has(path)))))
    );
    if (!exception || exception.package !== advisory.module_name || exception.expires < today || !scopedFindingsMatch) {
      failures.push(`${advisory.severity.toUpperCase()} ${advisory.module_name}: ${id || advisory.title}`);
    }
  }
  return failures;
}
