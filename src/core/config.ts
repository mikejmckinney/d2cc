// design-to-code-contract — config loader
// Loads design-contract.config.js from the project root.
// Supports ESM, CJS, and JSON config formats.
// SPDX-License-Identifier: MIT

import { resolve, extname } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { ContractConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

const CONFIG_NAMES = [
  "design-contract.config.mjs",
  "design-contract.config.js",
  "design-contract.config.cjs",
  "design-contract.config.json",
];

/**
 * Deep-merge source into target. Arrays are replaced, not concatenated.
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      ) as T[keyof T];
    } else if (srcVal !== undefined) {
      result[key] = srcVal as T[keyof T];
    }
  }
  return result;
}

/**
 * Resolve the prototype path relative to the project root.
 */
function resolvePrototypePath(proto: string, projectRoot: string): string {
  if (resolve(proto) === proto) return proto; // already absolute
  return resolve(projectRoot, proto);
}

/**
 * Load config from the project root.
 * Falls back to defaults if no config file exists.
 */
export async function loadConfig(
  projectRoot: string,
): Promise<{ config: ContractConfig; configPath: string | null }> {
  // Find config file
  let configPath: string | null = null;
  for (const name of CONFIG_NAMES) {
    const candidate = resolve(projectRoot, name);
    if (existsSync(candidate)) {
      configPath = candidate;
      break;
    }
  }

  let userConfig: Partial<ContractConfig> = {};

  if (configPath) {
    const ext = extname(configPath);
    if (ext === ".json") {
      const { readFileSync } = await import("node:fs");
      userConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    } else {
      // ESM or CJS — use dynamic import with file URL
      const fileUrl = pathToFileURL(configPath).href;
      const mod = await import(fileUrl);
      userConfig = mod.default ?? mod;
    }
  }

  const config = deepMerge(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    userConfig as unknown as Record<string, unknown>,
  ) as unknown as ContractConfig;

  // Resolve prototype path relative to project root
  config.prototype = resolvePrototypePath(config.prototype, projectRoot);

  return { config, configPath };
}

/**
 * Generate a default config file content.
 */
export function generateDefaultConfig(): string {
  return `// design-to-code-contract configuration
// See https://github.com/yourorg/design-to-code-contract for schema docs.
export default {
  prototype: "prototype.html",
  implementation: {
    src: "src",
    css: "src/app.css",
  },
  cssSync: {
    enabled: true,
    skipList: [],  // prototype-only classes to skip
  },
  structural: {
    enabled: true,
    // components: { "Dashboard.tsx": ["readiness-hero", "qs-card"] },
    // requiredTokens: ["--bg", "--fg", "--accent"],
    // svgPaths: { "Full Exam": "M9 3v18M3 9h18" },
    // patterns: { "gauge-svg": { file: "Dashboard.tsx", pattern: 'width="130"' } },
  },
  skeleton: {
    enabled: true,
    output: "component-skeletons.md",
    // sections: [
    //   { name: "Header", pattern: '(<header class="header".*?</header>)' },
    // ],
  },
  visual: {
    enabled: true,
    serverUrl: "http://localhost:5173",
    viewports: [
      { name: "desktop", width: 940, height: 800 },
      { name: "mobile", width: 390, height: 844 },
    ],
    outputDir: "visual-regression",
    skipClasses: [],
  },
};
`;
}
