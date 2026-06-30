import type { ContractConfig } from "../../core/types.js";
import type { SuiteResult } from "../../core/types.js";
export declare function extractPrototypeClasses(protoPath: string): string[];
export declare function extractPrototypeClassNames(protoPath: string): string[];
export interface InlineToken {
    name: string;
    value: string;
    source: "inline-attr" | "js-object";
}
export declare function extractInlineTokens(protoPath: string): InlineToken[];
export declare function extractJsThemeTokens(protoPath: string): Record<string, InlineToken[]>;
export declare function classExistsInCss(className: string, cssPath: string): boolean;
export declare function tokenExistsInCss(tokenName: string, expectedValue: string, cssPath: string, selectorBlock?: string): {
    exists: boolean;
    actualValue: string | null;
};
export declare function runCssSync(config: ContractConfig, projectRoot: string): SuiteResult;
//# sourceMappingURL=index.d.ts.map