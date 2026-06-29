// design-to-code-contract — Visual diff
// Compares prototype to implementation via Playwright screenshots and
// CSS class name diffing.
// SPDX-License-Identifier: MIT

import { readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import type { ContractConfig } from "../../core/types.js";
import { check, suite } from "../../core/reporter.js";
import type { SuiteResult } from "../../core/types.js";

interface Viewport {
  name: string;
  width: number;
  height: number;
}

/**
 * Check if Playwright is available.
 */
function hasPlaywright(): boolean {
  try {
    execSync("npx playwright --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if ImageMagick convert is available.
 */
function hasImageMagick(): boolean {
  try {
    execSync("convert --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a dev server to be ready.
 */
function waitForServer(url: string, timeoutMs: number): boolean {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      execSync(`curl -s --connect-timeout 1 "${url}"`, { stdio: "ignore" });
      return true;
    } catch {
      // Server not ready yet
    }
  }
  return false;
}

/**
 * Parse a shell command string into [command, args[]].
 * Handles "npm run dev", "npx vite --port 5173", etc.
 */
function parseCommand(cmd: string): [string, string[]] {
  const parts = cmd.trim().split(/\s+/);
  return [parts[0], parts.slice(1)];
}

/**
 * Capture screenshots using Playwright CLI.
 */
function captureScreenshots(
  url: string,
  outputDir: string,
  prefix: string,
  viewports: Viewport[],
): string[] {
  const files: string[] = [];
  mkdirSync(outputDir, { recursive: true });

  for (const vp of viewports) {
    const outPath = join(outputDir, `${prefix}-${vp.name}.png`);
    const outPathFull = join(outputDir, `${prefix}-${vp.name}-full.png`);

    try {
      execSync(
        `npx playwright screenshot --browser chromium --viewport-size "${vp.width},${vp.height}" "${url}" "${outPath}"`,
        { stdio: "ignore" },
      );
      files.push(outPath);
    } catch {
      // screenshot failed
    }

    try {
      execSync(
        `npx playwright screenshot --browser chromium --viewport-size "${vp.width},${vp.height}" --full-page "${url}" "${outPathFull}"`,
        { stdio: "ignore" },
      );
      files.push(outPathFull);
    } catch {
      // screenshot failed
    }
  }

  return files;
}

/**
 * Create side-by-side comparison images.
 */
function createComparisons(
  outputDir: string,
  viewports: Viewport[],
): string[] {
  if (!hasImageMagick()) return [];

  const files: string[] = [];
  for (const vp of viewports) {
    for (const suffix of ["", "-full"]) {
      const protoImg = join(outputDir, `proto-${vp.name}${suffix}.png`);
      const reactImg = join(outputDir, `react-${vp.name}${suffix}.png`);
      const combined = join(outputDir, `compare-${vp.name}${suffix}.png`);

      if (existsSync(protoImg) && existsSync(reactImg)) {
        try {
          execSync(`convert "${protoImg}" "${reactImg}" +append "${combined}"`, {
            stdio: "ignore",
          });
          files.push(combined);
        } catch {
          // convert failed
        }
      }
    }
  }
  return files;
}

/**
 * Extract CSS class names from prototype's <style> blocks.
 */
function extractPrototypeCssClasses(protoPath: string): Set<string> {
  if (!existsSync(protoPath)) return new Set();
  const html = readFileSync(protoPath, "utf-8");
  const classes = new Set<string>();

  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch: RegExpExecArray | null;
  while ((styleMatch = styleRegex.exec(html)) !== null) {
    const block = styleMatch[1];
    const classRegex = /\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
    let classMatch: RegExpExecArray | null;
    while ((classMatch = classRegex.exec(block)) !== null) {
      classes.add(classMatch[1]);
    }
  }

  return classes;
}

/**
 * Check if a CSS class is used in the implementation source files.
 */
function classInSource(
  className: string,
  srcDir: string,
  skipList: Set<string>,
): boolean {
  if (skipList.has(className)) return true;

  try {
    const compDir = join(srcDir, "components");
    const appDir = join(srcDir, "app");

    for (const dir of [compDir, appDir]) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter(
        (f) => f.endsWith(".tsx") || f.endsWith(".ts"),
      );
      for (const f of files) {
        const content = readFileSync(join(dir, f), "utf-8");
        if (content.includes(className)) return true;
      }
    }
  } catch {
    // directory read failed
  }

  return false;
}

/**
 * Run the visual diff check.
 */
export function runVisual(
  config: ContractConfig,
  projectRoot: string,
): SuiteResult {
  const checkName = "Visual Regression";

  if (config.visual?.enabled === false) {
    return suite(checkName, [], true, "disabled in config");
  }

  const protoPath = resolve(projectRoot, config.prototype);
  const srcDir = resolve(projectRoot, config.implementation.src);
  const outputDir = resolve(
    projectRoot,
    config.visual?.outputDir ?? "visual-regression",
  );
  const serverUrl = config.visual?.serverUrl ?? "http://localhost:5173";
  const devCommand = config.visual?.devCommand;
  const serverTimeout = config.visual?.serverTimeout ?? 30000;
  const viewports = config.visual?.viewports ?? [
    { name: "desktop", width: 940, height: 800 },
    { name: "mobile", width: 390, height: 844 },
  ];
  const skipList = new Set([
    ...(config.globalSkipList ?? []),
    ...(config.visual?.skipClasses ?? []),
  ]);

  if (!existsSync(protoPath)) {
    return suite(checkName, [], true, `prototype not found: ${protoPath}`);
  }

  const checks = [];
  const screenshotsTaken: string[] = [];
  let startedServer: ChildProcess | null = null;
  let serverReady = false;

  // 1. Screenshots (if Playwright available)
  if (hasPlaywright()) {
    // Check if server is already running
    try {
      execSync(`curl -s --connect-timeout 2 "${serverUrl}"`, { stdio: "ignore" });
      serverReady = true;
    } catch {
      // Server not running — try to start it via devCommand
      if (devCommand) {
        const [cmd, args] = parseCommand(devCommand);
        try {
          startedServer = spawn(cmd, args, {
            cwd: projectRoot,
            stdio: "ignore",
            detached: true,
          });
          serverReady = waitForServer(serverUrl, serverTimeout);
        } catch {
          // Failed to start server
        }
      }
    }

    if (serverReady) {
      // Capture prototype screenshots
      const protoUrl = `file://${protoPath}`;
      screenshotsTaken.push(
        ...captureScreenshots(protoUrl, outputDir, "proto", viewports),
      );

      // Capture React screenshots
      screenshotsTaken.push(
        ...captureScreenshots(serverUrl, outputDir, "react", viewports),
      );

      // Create side-by-side comparisons
      const comparisons = createComparisons(outputDir, viewports);

      checks.push(
        check(
          "visual:screenshots",
          checkName,
          screenshotsTaken.length > 0,
          screenshotsTaken.length > 0
            ? `${screenshotsTaken.length} screenshots captured → ${outputDir}/`
            : "No screenshots captured (Playwright may need: npx playwright install chromium)",
          screenshotsTaken.length > 0 ? "info" : "warning",
        ),
      );

      if (comparisons.length > 0) {
        checks.push(
          check(
            "visual:comparisons",
            checkName,
            true,
            `${comparisons.length} side-by-side comparisons created`,
            "info",
          ),
        );
      }
    } else {
      const hint = devCommand
        ? `Dev server not available at ${serverUrl} — tried: ${devCommand}`
        : `Dev server not available at ${serverUrl} — set visual.devCommand in config or start the server manually`;
      checks.push(
        check(
          "visual:screenshots",
          checkName,
          false,
          hint,
          "warning",
        ),
      );
    }
  } else {
    checks.push(
      check(
        "visual:screenshots",
        checkName,
        false,
        "Playwright not installed — screenshots skipped (run: npx playwright install chromium)",
        "warning",
      ),
    );
  }

  // 2. DOM class diff (always runs, no dependencies)
  const protoClasses = extractPrototypeCssClasses(protoPath);
  const missing: string[] = [];

  for (const cls of protoClasses) {
    if (cls.length <= 2) continue;
    if (skipList.has(cls)) continue;
    if (!classInSource(cls, srcDir, skipList)) {
      missing.push(cls);
    }
  }

  checks.push(
    check(
      "visual:dom-diff",
      checkName,
      missing.length === 0,
      missing.length === 0
        ? `All ${protoClasses.size} prototype CSS classes found in implementation source`
        : `${missing.length} prototype CSS classes NOT found in implementation: ${missing.join(", ")}`,
    ),
  );

  // Clean up server if we started it
  if (startedServer) {
    try {
      startedServer.kill("SIGTERM");
      if (startedServer.pid) {
        try { process.kill(-startedServer.pid, "SIGTERM"); } catch { /* already dead */ }
      }
    } catch { /* already dead */ }
  }

  return suite(checkName, checks);
}
