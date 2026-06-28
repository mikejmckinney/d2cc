// design-to-code-contract — reporter
// Renders SuiteResult[] as text or JSON.
// SPDX-License-Identifier: MIT
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
function icon(passed, severity) {
    if (severity === "warning")
        return `${YELLOW}⚠${RESET}`;
    return passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
}
function renderCheck(check) {
    return `  ${icon(check.passed, check.severity)} ${check.message}`;
}
function renderSuite(suite, index) {
    const lines = [];
    const label = `${index + 1}. ${suite.suite}`;
    lines.push(`${BOLD}${label}${RESET}`);
    if (suite.skipped) {
        lines.push(`  ${DIM}(skipped: ${suite.skipReason})${RESET}`);
        return lines.join("\n");
    }
    for (const check of suite.checks) {
        lines.push(renderCheck(check));
    }
    const parts = [];
    if (suite.passed > 0)
        parts.push(`${GREEN}${suite.passed} passed${RESET}`);
    if (suite.failed > 0)
        parts.push(`${RED}${suite.failed} failed${RESET}`);
    if (suite.warnings > 0)
        parts.push(`${YELLOW}${suite.warnings} warnings${RESET}`);
    lines.push(`  ${parts.join(", ")}`);
    return lines.join("\n");
}
/**
 * Render a full report as text (for terminal output).
 */
export function renderText(report) {
    const lines = [];
    lines.push(`${BOLD}━━━ Design-to-Code Contract ━━━${RESET}`);
    lines.push("");
    for (let i = 0; i < report.suites.length; i++) {
        lines.push(renderSuite(report.suites[i], i));
        lines.push("");
    }
    lines.push(`${BOLD}━━━ Summary ━━━${RESET}`);
    const parts = [];
    if (report.totalPassed > 0)
        parts.push(`${GREEN}${report.totalPassed} passed${RESET}`);
    if (report.totalFailed > 0)
        parts.push(`${RED}${report.totalFailed} failed${RESET}`);
    if (report.totalWarnings > 0)
        parts.push(`${YELLOW}${report.totalWarnings} warnings${RESET}`);
    lines.push(parts.join(", "));
    if (report.exitCode === 0) {
        lines.push(`${GREEN}${BOLD}✅ All contract checks pass${RESET}`);
    }
    else {
        lines.push(`${RED}${BOLD}❌ Contract violations found — fix before shipping${RESET}`);
    }
    return lines.join("\n");
}
/**
 * Render a full report as JSON (for CI integration).
 */
export function renderJSON(report) {
    return JSON.stringify(report, null, 2);
}
/**
 * Build a ContractReport from an array of SuiteResults.
 */
export function buildReport(suites) {
    let totalPassed = 0;
    let totalFailed = 0;
    let totalWarnings = 0;
    for (const suite of suites) {
        if (!suite.skipped) {
            totalPassed += suite.passed;
            totalFailed += suite.failed;
            totalWarnings += suite.warnings;
        }
    }
    return {
        suites,
        totalPassed,
        totalFailed,
        totalWarnings,
        exitCode: totalFailed > 0 ? 1 : 0,
        timestamp: new Date().toISOString(),
    };
}
/**
 * Helper: create a single CheckResult.
 */
export function check(id, name, passed, message, severity = "error") {
    return { id, name, passed, message, severity };
}
/**
 * Helper: create a SuiteResult from check results.
 */
export function suite(name, checks, skipped = false, skipReason) {
    const passed = checks.filter((c) => c.passed).length;
    const failed = checks.filter((c) => !c.passed && c.severity === "error").length;
    const warnings = checks.filter((c) => !c.passed && c.severity === "warning").length;
    return { suite: name, checks, passed, failed, warnings, skipped, skipReason };
}
//# sourceMappingURL=reporter.js.map