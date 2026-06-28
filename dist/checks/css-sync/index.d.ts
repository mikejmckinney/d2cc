import type { ContractConfig } from "../../core/types.js";
import type { SuiteResult } from "../../core/types.js";
/**
 * Extract CSS class selectors from a prototype HTML file's <style> blocks.
 */
export declare function extractPrototypeClasses(protoPath: string): string[];
/**
 * Check if a CSS class is defined in the implementation CSS file.
 */
export declare function classExistsInCss(className: string, cssPath: string): boolean;
/**
 * Run the CSS Sync check.
 */
export declare function runCssSync(config: ContractConfig, projectRoot: string): SuiteResult;
//# sourceMappingURL=index.d.ts.map