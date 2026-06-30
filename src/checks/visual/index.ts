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
  seedIdb?: boolean;
  reload?: boolean;
  clickExactButton?: string;
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
async function executeStep(page: any, step: NavStep, url: string, isReact: boolean): Promise<boolean> {
  if (step.dismiss) {
    try {
      const btn = page.locator(`button:has-text("${step.dismiss}")`).first();
      if (await btn.isVisible({ timeout: 3000 })) {
        await btn.click({ timeout: 5000 });
        await sleep(500);
      }
    } catch { /* no modal */ }
  }

  if (step.seedIdb && isReact) {
    await seedIndexedDB(page);
    await sleep(500);
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
  isReact: boolean,
): Promise<string | null> {
  const outPath = join(outputDir, `${prefix}-${viewportName}-${screen.name}.png`);

  if (isFirstLoad) {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await sleep(1500);
    await dismissOverlays(page);
  }

  const steps = screen.steps ?? (screen.navText ? [{ click: screen.navText }] : []);
  for (const step of steps) {
    const ok = await executeStep(page, step, url, isReact);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedIndexedDB(page: any): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("cctc-app", 1);
      request.onerror = () => reject(new Error("Failed to open IndexedDB"));
      request.onsuccess = () => {
        const db = request.result;
        const now = Date.now();
        const day = 86400000;

        const entries = [
          { id: "seed-0", completedAt: new Date(now - 6 * 3 * day).toISOString(), settings: { blueprintId: "cctc-from-2026-07", questionSet: "standard", questionCount: 10, timed: true, timeMinutes: 30, showTimer: true, mode: "exam", includeDrafts: false, targetThreshold: 70 }, timeUsedSeconds: 1800, itemIds: [], items: [], answers: {}, flaggedForReview: [], result: { correct: 7, total: 10, percent: 70, estimatedPass: true, breakdown: [{ categoryId: "1", categoryLabel: "Education", correct: 2, total: 3 }, { categoryId: "2", categoryLabel: "Pre-transplant", correct: 3, total: 4 }, { categoryId: "3", categoryLabel: "Post-op", correct: 2, total: 3 }] } },
          { id: "seed-1", completedAt: new Date(now - 3 * 3 * day).toISOString(), settings: { blueprintId: "cctc-from-2026-07", questionSet: "standard", questionCount: 10, timed: true, timeMinutes: 30, showTimer: true, mode: "exam", includeDrafts: false, targetThreshold: 70 }, timeUsedSeconds: 2400, itemIds: [], items: [], answers: {}, flaggedForReview: [], result: { correct: 8, total: 10, percent: 80, estimatedPass: true, breakdown: [{ categoryId: "1", categoryLabel: "Education", correct: 3, total: 3 }, { categoryId: "2", categoryLabel: "Pre-transplant", correct: 3, total: 4 }, { categoryId: "3", categoryLabel: "Post-op", correct: 2, total: 3 }] } },
        ];

        const flags = [
          { id: "flag-seed-0", item_id: "cctc-1001", version: 1, status: "reviewed", reason: "typo / wording", comment: "Sample flag for visual testing", session_id: "seed-0", blueprint: "cctc-from-2026-07", mode: "exam", createdAt: new Date(now - 2 * day).toISOString(), updatedAt: new Date(now - 2 * day).toISOString() }
        ];

        const tx = db.transaction(["history", "flags"], "readwrite");
        const historyStore = tx.objectStore("history");
        const flagsStore = tx.objectStore("flags");

        for (const entry of entries) { historyStore.put(entry); }
        for (const flag of flags) { flagsStore.put(flag); }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error("Failed to seed IndexedDB"));
      };
    });
  });
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
            screens[i], i === 0, false,
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
            screens[i], i === 0, true,
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
