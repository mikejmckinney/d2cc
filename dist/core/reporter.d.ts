import type { ContractReport, SuiteResult, CheckResult } from "./types.js";
/**
 * Render a full report as text (for terminal output).
 */
export declare function renderText(report: ContractReport): string;
/**
 * Render a full report as JSON (for CI integration).
 */
export declare function renderJSON(report: ContractReport): string;
/**
 * Build a ContractReport from an array of SuiteResults.
 */
export declare function buildReport(suites: SuiteResult[]): ContractReport;
/**
 * Helper: create a single CheckResult.
 */
export declare function check(id: string, name: string, passed: boolean, message: string, severity?: "error" | "warning" | "info"): CheckResult;
/**
 * Helper: create a SuiteResult from check results.
 */
export declare function suite(name: string, checks: CheckResult[], skipped?: boolean, skipReason?: string): SuiteResult;
//# sourceMappingURL=reporter.d.ts.map