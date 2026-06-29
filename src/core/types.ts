// design-to-code-contract — core types
// SPDX-License-Identifier: MIT

/** Result of a single check item */
export interface CheckResult {
  id: string;
  name: string;
  passed: boolean;
  message: string;
  severity: "error" | "warning" | "info";
}

/** Aggregated result of a full check suite */
export interface SuiteResult {
  suite: string;
  checks: CheckResult[];
  passed: number;
  failed: number;
  warnings: number;
  skipped: boolean;
  skipReason?: string;
}

/** The full contract report */
export interface ContractReport {
  suites: SuiteResult[];
  totalPassed: number;
  totalFailed: number;
  totalWarnings: number;
  exitCode: number;
  timestamp: string;
}

/** Per-project contract configuration */
export interface ContractConfig {
  /** Path to the prototype HTML file (source of truth) */
  prototype: string;

  /** Implementation source directory (glob pattern) */
  implementation: {
    /** Source directory with React/Vue/etc components */
    src: string;
    /** Built/dist entry HTML (optional, for visual checks) */
    entry?: string;
    /** CSS file to check against prototype */
    css: string;
  };

  /** CSS sync check configuration */
  cssSync?: {
    /** Whether to run this check */
    enabled?: boolean;
    /** Classes to skip (prototype-only artifacts) */
    skipList?: string[];
  };

  /** Structural verification configuration */
  structural?: {
    /** Whether to run this check */
    enabled?: boolean;
    /** Component file → class name mappings */
    components?: Record<string, string[]>;
    /** Required CSS tokens */
    requiredTokens?: string[];
    /** Required SVG paths or patterns */
    svgPaths?: Record<string, string>;
    /** Structural patterns to verify */
    patterns?: Record<string, { file: string; pattern: string }>;
  };

  /** Skeleton extraction configuration */
  skeleton?: {
    /** Whether to run this check */
    enabled?: boolean;
    /** Output file path */
    output?: string;
    /** Section extraction patterns */
    sections?: Array<{ name: string; pattern: string }>;
  };

  /** Visual regression configuration */
  visual?: {
    /** Whether to run this check */
    enabled?: boolean;
    /** Dev server URL */
    serverUrl?: string;
    /** Command to start the dev server (e.g. "npm run dev"). If set, d2cc
     *  starts the server automatically when it's not already running. */
    devCommand?: string;
    /** Milliseconds to wait for dev server to be ready (default: 30000) */
    serverTimeout?: number;
    /** Viewport widths to capture */
    viewports?: Array<{ name: string; width: number; height: number }>;
    /** Output directory for screenshots */
    outputDir?: string;
    /** Classes to skip in DOM diff */
    skipClasses?: string[];
  };

  /** Global skip list — classes exempt from all checks */
  globalSkipList?: string[];
}

/** Default configuration template */
export const DEFAULT_CONFIG: ContractConfig = {
  prototype: "prototype.html",
  implementation: {
    src: "src",
    css: "src/app.css",
  },
  cssSync: { enabled: true, skipList: [] },
  structural: { enabled: true },
  skeleton: { enabled: true, output: "component-skeletons.md" },
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
