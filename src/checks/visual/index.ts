// design-to-code-contract — Visual diff
// Compares prototype to implementation via Playwright screenshots,
// multi-screen navigation with step sequences, seed data injection,
// and CSS class name diffing.
// SPDX-License-Identifier: MIT

import { readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { ContractConfig } from "../../core/types.js";
import { check, suite } from "../../core/reporter.js";
import type { SuiteResult, CheckResult } from "../../core/types.js";

interface Viewport {
  name: string;
  width: number;
  height: number;
}

interface NavStep {
  click?: string | string[];
  waitFor?: string | string[];
  waitForText?: string;
  wait?: number;
  dismiss?: string;
  reload?: boolean;
  clickExactButton?: string;
  /** Run a project-defined custom step. Value matches a key in visual.customStepFiles config. */
  custom?: string;
}

interface ScreenDef {
  name: string;
  navText?: string;
  steps?: NavStep[];
  reloadBeforeCapture?: boolean;
}

const DEFAULT_SCREENS: ScreenDef[] = [
  { name: "dashboard", navText: "Home" },
  { name: "setup", navText: "Setup" },
  { name: "progress", navText: "Progress" },
];

async function hasPlaywright(): Promise<boolean> {
  try {
    await import("@playwright/test");
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.status < 500) return true;
    } catch { /* not ready */ }
    await sleep(1000);
  }
  return false;
}

function parseCommand(cmd: string): [string, string[]] {
  const parts = cmd.trim().split(/\s+/);
  return [parts[0], parts.slice(1)];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dismissOverlays(page: any): Promise<void> {
  for (const text of ["I understand", "Accept", "Close", "Dismiss", "OK", "Got it", "Start new", "Cancel"]) {
    try {
      const btn = page.locator(`button:has-text("${text}")`).first();
      if (await btn.isVisible({ timeout: 800 })) {
        await btn.click({ timeout: 3000 });
        await sleep(400);
      }
    } catch { /* no overlay */ }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function clickElement(page: any, text: string, timeout = 10000): Promise<boolean> {
  if (/^[.#\[]/.test(text) || /^(button|a|div|span|input|select|label)\b/.test(text) || text.includes('>>')) {
    try {
      await page.locator(text).first().click({ timeout: Math.min(timeout, 5000) });
      return true;
    } catch { /* selector not found */ }
  }

  const perSelectorTimeout = Math.min(timeout / 4, 3000);
  const selectors = [
    `button:has-text("${text}")`,
    `[title="${text}"]`,
    `a:has-text("${text}")`,
    `[aria-label="${text}"]`,
  ];
  for (const selector of selectors) {
    try {
      await page.locator(selector).first().click({ timeout: perSelectorTimeout });
      return true;
    } catch { /* try next */ }
  }
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeStep(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  step: NavStep,
  url: string,
  customStepFiles?: Record<string, string>,
  projectRoot?: string,
): Promise<boolean> {
  if (step.dismiss) {
    try {
      const btn = page.locator(`button:has-text("${step.dismiss}")`).first();
      if (await btn.isVisible({ timeout: 3000 })) {
        await btn.click({ timeout: 5000 });
        await sleep(500);
      }
    } catch { /* no modal */ }
  }

  if (step.custom) {
    // Custom steps are project-specific — skip silently on prototype side
    if (!customStepFiles || !projectRoot) {
      return true;
    }
    const fileRel = customStepFiles[step.custom];
    if (!fileRel) {
      console.log(`    [visual] custom step "${step.custom}" not found in visual.customStepFiles`);
      return false;
    }
    const fileAbs = resolve(projectRoot, fileRel);
    if (!existsSync(fileAbs)) {
      console.log(`    [visual] custom step file not found: ${fileAbs}`);
      return false;
    }
    const fileContents = readFileSync(fileAbs, "utf-8");
    try {
      await page.evaluate(fileContents);
      await sleep(500);
    } catch (e: unknown) {
      console.log(`    [visual] custom step "${step.custom}" failed: ${(e as Error).message?.slice(0, 200)}`);
      return false;
    }
  }

  if (step.reload) {
    await page.reload({ waitUntil: "networkidle", timeout: 30000 });
    await sleep(8000);
    await dismissOverlays(page);
    await sleep(2000);
  }

  if (step.wait) {
    await sleep(step.wait);
  }

  if (step.waitFor) {
    const waitForList = Array.isArray(step.waitFor) ? step.waitFor : [step.waitFor];
    let waited = false;
    for (const sel of waitForList) {
      try {
        await page.locator(sel).first().waitFor({ state: "visible", timeout: 8000 });
        waited = true;
        break;
      } catch { /* try next */ }
    }
    if (!waited) {
      console.log(`    [visual] waitFor all selectors timed out: ${JSON.stringify(waitForList)}`);
      return false;
    }
  }

  if (step.waitForText) {
    try {
      for (const textSel of [
        `text="${step.waitForText}"`,
        `:text("${step.waitForText}")`,
        `:has-text("${step.waitForText}")`,
      ]) {
        try {
          await page.locator(textSel).first().waitFor({ state: "visible", timeout: 5000 });
          break;
        } catch { /* try next */ }
      }
    } catch {
      console.log(`    [visual] waitForText "${step.waitForText}" timed out`);
      return false;
    }
  }

  if (step.clickExactButton) {
    try {
      await page.getByRole("button", { name: step.clickExactButton, exact: true }).click({ timeout: 10000 });
      await sleep(600);
    } catch {
      console.log(`    [visual] clickExactButton "${step.clickExactButton}" failed`);
      return false;
    }
  }

  if (step.click) {
    const clickList = Array.isArray(step.click) ? step.click : [step.click];
    let clicked = false;
    for (const sel of clickList) {
      if (await clickElement(page, sel)) {
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      console.log(`    [visual] could not click any of: ${JSON.stringify(clickList)}`);
      return false;
    }
    await sleep(600);
  }

  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function navigateAndCapture(
  page: any,
  url: string,
  outputDir: string,
  prefix: string,
  viewportName: string,
  screen: ScreenDef,
  isFirstLoad: boolean,
  customStepFiles?: Record<string, string>,
  projectRoot?: string,
): Promise<string | null> {
  const outPath = join(outputDir, `${prefix}-${viewportName}-${screen.name}.png`);

  if (isFirstLoad) {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await sleep(1500);
    await dismissOverlays(page);
  }

  const steps = screen.steps ?? (screen.navText ? [{ click: screen.navText }] : []);
  for (const step of steps) {
    const ok = await executeStep(page, step, url, customStepFiles, projectRoot);
    if (!ok) {
      console.log(`    [visual] step failed for "${screen.name}": ${JSON.stringify(step)}`);
      return null;
    }
  }

  if (screen.reloadBeforeCapture) {
    await page.reload({ waitUntil: "networkidle", timeout: 30000 });
    await sleep(5000);
    await dismissOverlays(page);
    try {
      await page.locator('button').first().waitFor({ state: "visible", timeout: 15000 });
    } catch { /* no buttons rendered yet */ }
    await sleep(1000);
  }

  await sleep(500);
  await page.screenshot({ path: outPath, fullPage: true });
  return outPath;
}

async function createComparison(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  playwright: any,
  protoPath: string,
  reactPath: string,
  outputPath: string,
  viewportWidth: number,
): Promise<string | null> {
  if (!existsSync(protoPath) || !existsSync(reactPath)) return null;

  try {
    const protoData = readFileSync(protoPath).toString("base64");
    const reactData = readFileSync(reactPath).toString("base64");

    const html = `<!DOCTYPE html>
<html>
<head><style>
body { margin: 0; display: flex; font-family: system-ui, sans-serif; background: #1a1a1a; }
.col { flex: 1; display: flex; flex-direction: column; }
.col img { width: 100%; height: auto; }
.label { background: #333; color: #fff; padding: 8px 12px; font-size: 13px; font-weight: 600; text-align: center; }
</style></head>
<body>
<div class="col"><div class="label">Prototype</div><img src="data:image/png;base64,${protoData}"></div>
<div class="col"><div class="label">Implementation</div><img src="data:image/png;base64,${reactData}"></div>
</body></html>`;

    const browser = await playwright.chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: viewportWidth * 2, height: 800 } });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.screenshot({ path: outputPath, fullPage: true });
    await browser.close();
    return outputPath;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`    [visual] comparison failed: ${msg.slice(0, 200)}`);
    return null;
  }
}

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

function classInSource(className: string, srcDir: string, skipList: Set<string>): boolean {
  if (skipList.has(className)) return true;
  try {
    const compDir = join(srcDir, "components");
    const appDir = join(srcDir, "app");
    for (const dir of [compDir, appDir]) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
      for (const f of files) {
        const content = readFileSync(join(dir, f), "utf-8");
        if (content.includes(className)) return true;
      }
    }
  } catch { /* dir read failed */ }
  return false;
}

export async function runVisual(
  config: ContractConfig,
  projectRoot: string,
): Promise<SuiteResult> {
  const checkName = "Visual Regression";

  if (config.visual?.enabled === false) {
    return suite(checkName, [], true, "disabled in config");
  }

  const protoPath = resolve(projectRoot, config.prototype);
  const srcDir = resolve(projectRoot, config.implementation.src);
  const outputDir = resolve(projectRoot, config.visual?.outputDir ?? "visual-regression");
  const serverUrl = config.visual?.serverUrl ?? "http://localhost:5173";
  const devCommand = config.visual?.devCommand;
  const serverTimeout = config.visual?.serverTimeout ?? 30000;
  const viewports = config.visual?.viewports ?? [
    { name: "desktop", width: 940, height: 800 },
    { name: "mobile", width: 390, height: 844 },
  ];
  const screens = config.visual?.screens ?? DEFAULT_SCREENS;
  const customStepFiles = config.visual?.customStepFiles;
  const skipList = new Set([
    ...(config.globalSkipList ?? []),
    ...(config.visual?.skipClasses ?? []),
  ]);

  if (!existsSync(protoPath)) {
    return suite(checkName, [], true, `prototype not found: ${protoPath}`);
  }

  const checks: CheckResult[] = [];
  const screenshotsTaken: string[] = [];
  const comparisonsCreated: string[] = [];
  let startedServer: ChildProcess | null = null;
  let protoServer: ChildProcess | null = null;
  let serverReady = false;

  const pwAvailable = await hasPlaywright();

  if (pwAvailable) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const playwright: any = await import("@playwright/test");

    try {
      const res = await fetch(serverUrl, { signal: AbortSignal.timeout(3000) });
      if (res.status < 500) serverReady = true;
    } catch { /* not running */ }

    if (!serverReady && devCommand) {
      const [cmd, args] = parseCommand(devCommand);
      try {
        console.log(`  Starting dev server: ${devCommand}`);
        startedServer = spawn(cmd, args, { cwd: projectRoot, stdio: "ignore", detached: true });
        serverReady = await waitForServer(serverUrl, serverTimeout);
        if (serverReady) console.log(`  Dev server ready at ${serverUrl}`);
      } catch (e) {
        console.error(`  Failed to start dev server: ${e}`);
      }
    }

    if (serverReady) {
      mkdirSync(outputDir, { recursive: true });

      // Serve prototype over HTTP
      const protoDir = protoPath.replace(/[^/\\]+$/, "");
      const protoFileName = protoPath.replace(/^.*[/\\]/, "");
      const protoServerUrl = "http://localhost:9876";

      protoServer = spawn("npx", ["http-server", protoDir, "-p", "9876", "-s", "--cors"], {
        cwd: projectRoot, stdio: "ignore", detached: true,
      });
      let protoReady = await waitForServer(protoServerUrl, 15000);

      if (!protoReady) {
        try { if (protoServer.pid) process.kill(-protoServer.pid, "SIGTERM"); } catch {}
        protoServer = spawn("python3", ["-m", "http.server", "9876"], {
          cwd: protoDir, stdio: "ignore", detached: true,
        });
        protoReady = await waitForServer(protoServerUrl, 8000);
      }

      if (!protoReady) {
        console.log(`    [visual] could not serve prototype over HTTP`);
        try { if (protoServer.pid) process.kill(-protoServer.pid, "SIGTERM"); } catch {}
        protoServer = null;
      }

      for (const vp of viewports) {
        // Capture prototype screens
        const pBrowser = await playwright.chromium.launch();
        const pCtx = await pBrowser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const pPage = await pCtx.newPage();

        const protoUrl = protoReady
          ? `${protoServerUrl}/${protoFileName.replace(/ /g, "%20")}`
          : `file://${protoPath.replace(/ /g, "%20")}`;

        for (let i = 0; i < screens.length; i++) {
          const result = await navigateAndCapture(
            pPage, protoUrl, outputDir, "proto", vp.name,
            screens[i], i === 0,
          );
          if (result) screenshotsTaken.push(result);
        }
        await pBrowser.close();

        // Capture React screens
        const rBrowser = await playwright.chromium.launch();
        const rCtx = await rBrowser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const rPage = await rCtx.newPage();

        for (let i = 0; i < screens.length; i++) {
          const result = await navigateAndCapture(
            rPage, serverUrl, outputDir, "react", vp.name,
            screens[i], i === 0, customStepFiles, projectRoot,
          );
          if (result) screenshotsTaken.push(result);
        }
        await rBrowser.close();

        // Create side-by-side comparisons (Playwright-based, no ImageMagick)
        for (const screen of screens) {
          const protoImg = join(outputDir, `proto-${vp.name}-${screen.name}.png`);
          const reactImg = join(outputDir, `react-${vp.name}-${screen.name}.png`);
          const compareImg = join(outputDir, `compare-${vp.name}-${screen.name}.png`);
          const result = await createComparison(playwright, protoImg, reactImg, compareImg, vp.width);
          if (result) comparisonsCreated.push(result);
        }
      }

      checks.push(check(
        "visual:screenshots", checkName,
        screenshotsTaken.length > 0,
        screenshotsTaken.length > 0
          ? `${screenshotsTaken.length} screenshots across ${screens.length} screens × ${viewports.length} viewports → ${outputDir}/`
          : "No screenshots captured (Playwright may need: npx playwright install chromium)",
        screenshotsTaken.length > 0 ? "info" : "warning",
      ));

      checks.push(check(
        "visual:comparisons", checkName,
        comparisonsCreated.length > 0,
        comparisonsCreated.length > 0
          ? `${comparisonsCreated.length} side-by-side comparisons created (Playwright-rendered, no ImageMagick)`
          : "No comparisons created — screenshot pairs missing",
        comparisonsCreated.length > 0 ? "info" : "warning",
      ));
    } else {
      const hint = devCommand
        ? `Dev server not available at ${serverUrl} — tried: ${devCommand}`
        : `Dev server not available at ${serverUrl} — set visual.devCommand in config or start the server manually`;
      checks.push(check("visual:screenshots", checkName, false, hint, "warning"));
    }
  } else {
    checks.push(check(
      "visual:screenshots", checkName, false,
      "Playwright not installed — screenshots skipped (run: npx playwright install chromium)",
      "warning",
    ));
  }

  // DOM class diff (always runs)
  const protoClasses = extractPrototypeCssClasses(protoPath);
  const missing: string[] = [];
  for (const cls of protoClasses) {
    if (cls.length <= 2) continue;
    if (skipList.has(cls)) continue;
    if (!classInSource(cls, srcDir, skipList)) missing.push(cls);
  }
  checks.push(check(
    "visual:dom-diff", checkName,
    missing.length === 0,
    missing.length === 0
      ? `All ${protoClasses.size} prototype CSS classes found in implementation source`
      : `${missing.length} prototype CSS classes NOT found in implementation: ${missing.join(", ")}`,
  ));

  // Cleanup servers
  for (const srv of [startedServer, protoServer]) {
    if (srv) {
      try { if (srv.pid) process.kill(-srv.pid, "SIGTERM"); } catch { /* already dead */ }
    }
  }

  return suite(checkName, checks);
}
