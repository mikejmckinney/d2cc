import type { ContractConfig } from "../../core/types.js";
import type { SuiteResult } from "../../core/types.js";
interface SectionResult {
    name: string;
    found: boolean;
    snippet: string;
    lineCount: number;
}
/**
 * Extract sections from prototype HTML using regex patterns.
 */
export declare function extractSections(protoPath: string, sections: Array<{
    name: string;
    pattern: string;
}>): SectionResult[];
/**
 * Render section results as a Markdown document.
 */
export declare function renderSkeletons(sections: SectionResult[], protoPath: string): string;
/**
 * Run the skeleton extraction check.
 */
export declare function runSkeleton(config: ContractConfig, projectRoot: string): SuiteResult;
export {};
//# sourceMappingURL=index.d.ts.map