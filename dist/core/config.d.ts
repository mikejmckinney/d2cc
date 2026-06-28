import type { ContractConfig } from "./types.js";
/**
 * Load config from the project root.
 * Falls back to defaults if no config file exists.
 */
export declare function loadConfig(projectRoot: string): Promise<{
    config: ContractConfig;
    configPath: string | null;
}>;
/**
 * Generate a default config file content.
 */
export declare function generateDefaultConfig(): string;
//# sourceMappingURL=config.d.ts.map