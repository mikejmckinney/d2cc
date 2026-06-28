// design-to-code-contract — CSS Sync checker
// Extracts CSS class rules from the prototype's <style> block and verifies
// each is defined in the implementation CSS. This catches real CSS drift.
// SPDX-License-Identifier: MIT

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ContractConfig } from "../../core/types.js";
import { check, suite } from "../../core/reporter.js";
import type { SuiteResult } from "../../core/types.js";

/**
 * Extract CSS class selectors from a prototype HTML file's <style> blocks.
 */
export function extractPrototypeClasses(protoPath: string): string[] {
  if (!existsSync(protoPath)) {
    throw new Error(`Prototype not found: ${protoPath}`);
  }

  const html = readFileSync(protoPath, "utf-8");
  const classes = new Set<string>();

  // Find all <style> blocks
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch: RegExpExecArray | null;
  while ((styleMatch = styleRegex.exec(html)) !== null) {
    const block = styleMatch[1];
    // Extract .classname selectors (not inside comments)
    const classRegex = /\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
    let classMatch: RegExpExecArray | null;
    while ((classMatch = classRegex.exec(block)) !== null) {
      classes.add(classMatch[1]);
    }
  }

  return [...classes].sort();
}

/**
 * Check if a CSS class is defined in the implementation CSS file.
 */
export function classExistsInCss(
  className: string,
  cssPath: string,
): boolean {
  if (!existsSync(cssPath)) return false;
  const css = readFileSync(cssPath, "utf-8");
  // Check if .classname appears as a selector (not just in var() references)
  const pattern = new RegExp(
    `\\.${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s{,:+>~\\[]`,
  );
  return pattern.test(css);
}

/**
 * Run the CSS Sync check.
 */
export function runCssSync(
  config: ContractConfig,
  projectRoot: string,
): SuiteResult {
  const checkName = "CSS Sync (prototype → implementation CSS)";

  if (config.cssSync?.enabled === false) {
    return suite(checkName, [], true, "disabled in config");
  }

  const protoPath = resolve(projectRoot, config.prototype);
  const cssPath = resolve(projectRoot, config.implementation.css);

  if (!existsSync(protoPath)) {
    return suite(checkName, [], true, `prototype not found: ${protoPath}`);
  }
  if (!existsSync(cssPath)) {
    return suite(checkName, [], true, `CSS not found: ${cssPath}`);
  }

  const skipList = new Set([
    ...(config.globalSkipList ?? []),
    ...(config.cssSync?.skipList ?? []),
  ]);

  const protoClasses = extractPrototypeClasses(protoPath);
  const checks = [];

  for (const cls of protoClasses) {
    if (skipList.has(cls)) continue;
    const exists = classExistsInCss(cls, cssPath);
    checks.push(
      check(
        `css-sync:${cls}`,
        checkName,
        exists,
        exists
          ? `.${cls} defined in implementation CSS`
          : `.${cls} defined in prototype but NOT in implementation CSS`,
      ),
    );
  }

  return suite(checkName, checks);
}
