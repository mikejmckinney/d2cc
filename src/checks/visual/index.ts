// design-to-code-contract — Visual diff
// Compares prototype to implementation via Playwright screenshots,
// multi-screen navigation with step sequences, seed data injection,
// computed layout property diffing, and CSS class name diffing.
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
  try { await import("@playwright/test"); return true; } catch { return false; }
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const res = await fetch(url, { signal: AbortSignal.timeout(3000) }); if (res.status < 500) return true; } catch {}
    await sleep(1000);
  }
  return false;
}

function parseCommand(cmd: string): [string, string[]] {
  const parts = cmd.trim().split(/\s+/);
  return [parts[0], parts.slice(1)];
}

async function dismissOverlays(page: any): Promise<void> {
  for (const text of ["I understand", "Accept", "Close", "Dismiss", "OK", "Got it", "Start new", "Cancel"]) {
    try {
      const btn = page.locator(`button:has-text("${text}")`).first();
      if (await btn.isVisible({ timeout: 800 })) {
        await btn.click({ timeout: 3000 });
        await sleep(400);
      }
    } catch {}
  }
}

async function clickElement(page: any, text: string, timeout = 10000): Promise<boolean> {
  if (/^[.#\[]/.test(text) || /^(button|a|div|span|input|select|label)\b/.test(text) || text.includes('>>')) {
    try { await page.locator(text).first().click({ timeout: Math.min(timeout, 5000) }); return true; } catch {}
  }
  const perSelectorTimeout = Math.min(timeout / 4, 3000);
  for (const sel of [`button:has-text("${text}")`, `[title="${text}"]`, `a:has-text("${text}")`, `[aria-label="${text}"]`]) {
    try { await page.locator(sel).first().click({ timeout: perSelectorTimeout }); return true; } catch {}
  }
  return false;
}

async function executeStep(page: any, step: NavStep, url: string, customStepFiles?: Record<string, string>, projectRoot?: string): Promise<boolean> {
  if (step.dismiss) {
    try {
      const btn = page.locator(`button:has-text("${step.dismiss}")`).first();
      if (await btn.isVisible({ timeout: 3000 })) { await btn.click({ timeout: 5000 }); await sleep(500); }
    } catch {}
  }
  if (step.custom) {
    if (!customStepFiles || !projectRoot) return true;
    const fileRel = customStepFiles[step.custom];
    if (!fileRel) { console.log(`    [visual] custom step "${step.custom}" not found in visual.customStepFiles`); return false; }
    const fileAbs = resolve(projectRoot, fileRel);
    if (!existsSync(fileAbs)) { console.log(`    [visual] custom step file not found: ${fileAbs}`); return false; }
    const fileContents = readFileSync(fileAbs, { encoding: "utf-8" });
    try { await page.evaluate(fileContents); await sleep(500); } catch (e: unknown) { console.log(`    [visual] custom step "${step.custom}" failed: ${(e as Error).message?.slice(0, 200)}`); return false; }
  }
  if (step.reload) {
    await page.reload({ waitUntil: "networkidle", timeout: 30000 });
    await sleep(8000);
    await dismissOverlays(page);
    await sleep(2000);
  }
  if (step.wait) { await sleep(step.wait); }
  if (step.waitFor) {
    const waitForList = Array.isArray(step.waitFor) ? step.waitFor : [step.waitFor];
    let waited = false;
    for (const sel of waitForList) { try { await page.locator(sel).first().waitFor({ state: "visible", timeout: 8000 }); waited = true; break; } catch {} }
    if (!waited) { console.log(`    [visual] waitFor all selectors timed out: ${JSON.stringify(waitForList)}`); return false; }
  }
  if (step.waitForText) {
    try {
      for (const textSel of [`text="${step.waitForText}"`, `:text("${step.waitForText}")`, `:has-text("${step.waitForText}")`]) {
        try { await page.locator(textSel).first().waitFor({ state: "visible", timeout: 5000 }); break; } catch {}
      }
    } catch { console.log(`    [visual] waitForText "${step.waitForText}" timed out`); return false; }
  }
  if (step.clickExactButton) {
    try { await page.getByRole("button", { name: step.clickExactButton, exact: true }).click({ timeout: 10000 }); await sleep(600); } catch { console.log(`    [visual] clickExactButton "${step.clickExactButton}" failed`); return false; }
  }
  if (step.click) {
    const clickList = Array.isArray(step.click) ? step.click : [step.click];
    let clicked = false;
    for (const sel of clickList) { if (await clickElement(page, sel)) { clicked = true; break; } }
    if (!clicked) { console.log(`    [visual] could not click any of: ${JSON.stringify(clickList)}`); return false; }
    await sleep(600);
  }
  return true;
}

async function navigateAndCapture(page: any, url: string, outputDir: string, prefix: string, viewportName: string, screen: ScreenDef, isFirstLoad: boolean, customStepFiles?: Record<string, string>, projectRoot?: string): Promise<string | null> {
  const outPath = join(outputDir, `${prefix}-${viewportName}-${screen.name}.png`);
  if (isFirstLoad) {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await sleep(1500);
    await dismissOverlays(page);
  }
  const steps = screen.steps ?? (screen.navText ? [{ click: screen.navText }] : []);
  for (const step of steps) {
    const ok = await executeStep(page, step, url, customStepFiles, projectRoot);
    if (!ok) { console.log(`    [visual] step failed for "${screen.name}": ${JSON.stringify(step)}`); return null; }
  }
  if (screen.reloadBeforeCapture) {
    await page.reload({ waitUntil: "networkidle", timeout: 30000 });
    await sleep(5000);
    await dismissOverlays(page);
    try { await page.locator('button').first().waitFor({ state: "visible", timeout: 15000 }); } catch {}
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
          { id: "seed-0", completedAt: new Date(now - 18 * day).toISOString(), settings: { blueprintId: "cctc-from-2026-07", questionSet: "standard", questionCount: 24, timed: true, timeMinutes: 180, showTimer: true, mode: "exam", includeDrafts: false, targetThreshold: 70 }, timeUsedSeconds: 1800, itemIds: [], items: [], answers: {}, flaggedForReview: [], result: { correct: 15, total: 24, percent: 62, estimatedPass: true, breakdown: [{ categoryId: "1", categoryLabel: "Education", correct: 5, total: 8 }, { categoryId: "2", categoryLabel: "Pre-transplant", correct: 5, total: 8 }, { categoryId: "3", categoryLabel: "Post-op", correct: 5, total: 8 }] } },
          { id: "seed-1", completedAt: new Date(now - 12 * day).toISOString(), settings: { blueprintId: "cctc-from-2026-07", questionSet: "standard", questionCount: 24, timed: true, timeMinutes: 180, showTimer: true, mode: "exam", includeDrafts: false, targetThreshold: 70 }, timeUsedSeconds: 2400, itemIds: [], items: [], answers: {}, flaggedForReview: [], result: { correct: 16, total: 24, percent: 66, estimatedPass: true, breakdown: [{ categoryId: "1", categoryLabel: "Education", correct: 5, total: 8 }, { categoryId: "2", categoryLabel: "Pre-transplant", correct: 6, total: 8 }, { categoryId: "3", categoryLabel: "Post-op", correct: 5, total: 8 }] } },
          { id: "seed-2", completedAt: new Date(now - 6 * day).toISOString(), settings: { blueprintId: "cctc-from-2026-07", questionSet: "standard", questionCount: 24, timed: false, timeMinutes: 180, showTimer: true, mode: "study", includeDrafts: false, targetThreshold: 70 }, timeUsedSeconds: null, itemIds: [], items: [], answers: {}, flaggedForReview: [], result: { correct: 16, total: 24, percent: 67, estimatedPass: true, breakdown: [{ categoryId: "1", categoryLabel: "Education", correct: 5, total: 8 }, { categoryId: "2", categoryLabel: "Pre-transplant", correct: 5, total: 8 }, { categoryId: "3", categoryLabel: "Post-op", correct: 6, total: 8 }] } },
        ];
        const flags = [{ id: "flag-seed-0", item_id: "cctc-1001", version: 1, status: "reviewed", reason: "typo / wording", comment: "Sample flag for visual testing", session_id: "seed-0", blueprint: "cctc-from-2026-07", mode: "exam", createdAt: new Date(now - 2 * day).toISOString(), updatedAt: new Date(now - 2 * day).toISOString() }];
        const tx = db.transaction(["history", "flags"], "readwrite");
        for (const entry of entries) { tx.objectStore("history").put(entry); }
        for (const flag of flags) { tx.objectStore("flags").put(flag); }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error("Failed to seed IndexedDB"));
      };
    });
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function extractLayoutProps(page: any): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const cs = (el: any, prop: string): string => {
      if (!el) return "N/A";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const val = (getComputedStyle(el) as any)[prop];
      return val != null ? String(val) : "N/A";
    };
    const elements: Record<string, any> = {
      header: document.querySelector("header, .app-header"),
      headerInner: document.querySelector(".app-header__inner"),
      nav: document.querySelector("nav, .app-header__nav"),
      shell: document.querySelector(".shell"),
      mainGrid: document.querySelector(".main-grid, .dashboard-grid"),
      card: document.querySelector(".card, .card--panel"),
      insight: document.querySelector(".readiness-insight"),
      expCard: document.querySelector(".explanation-card"),
      focusTrack: document.querySelector(".focus-bar-track"),
      optionLetter: document.querySelector(".option-letter"),
      quickCard: document.querySelector(".quick-card"),
    };
    const props: Record<string, string> = {};
    for (const [name, el] of Object.entries(elements)) {
      props[`${name}.padding`] = cs(el, "padding");
      props[`${name}.gap`] = cs(el, "gap");
      props[`${name}.borderRadius`] = cs(el, "borderRadius");
      props[`${name}.width`] = cs(el, "maxWidth");
    }
    return props;
  });
}

async function createComparison(playwright: any, protoPath: string, reactPath: string, outputPath: string, viewportWidth: number): Promise<string | null> {
  if (!existsSync(protoPath) || !existsSync(reactPath)) return null;
  try {
    const protoData = readFileSync(protoPath).toString("base64");
    const reactData = readFileSync(reactPath).toString("base64");
    const html = `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;font-family:system-ui,sans-serif;background:#1a1a1a}.col{flex:1;display:flex;flex-direction:column}.col img{width:100%;height:auto}.label{background:#333;color:#fff;padding:8px 12px;font-size:13px;font-weight:600;text-align:center}</style></head><body><div class="col"><div class="label">Prototype</div><img src="data:image/png;base64,${protoData}"></div><div class="col"><div class="label">Implementation</div><img src="data:image/png;base64,${reactData}"></div></body></html>`;
    const browser = await playwright.chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: viewportWidth * 2, height: 800 } });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.screenshot({ path: outputPath, fullPage: true });
    await browser.close();
    return outputPath;
  } catch (e: unknown) { console.error(`    [visual] comparison failed: ${(e as Error).message?.slice(0, 200)}`); return null; }
}

function extractPrototypeCssClasses(protoPath: string): Set<string> {
  if (!existsSync(protoPath)) return new Set();
  const html = readFileSync(protoPath, "utf-8");
  const classes = new Set<string>();
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch: RegExpExecArray | null;
  while ((styleMatch = styleRegex.exec(html)) !== null) {
    const classRegex = /\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
    let classMatch: RegExpExecArray | null;
    while ((classMatch = classRegex.exec(styleMatch[1])) !== null) { classes.add(classMatch[1]); }
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
      for (const f of readdirSync(dir).filter((f: string) => f.endsWith(".tsx") || f.endsWith(".ts"))) {
        if (readFileSync(join(dir, f), "utf-8").includes(className)) return true;
      }
    }
  } catch {}
  return false;
}

export async function runVisual(config: ContractConfig, projectRoot: string): Promise<SuiteResult> {
  const checkName = "Visual Regression";
  if (config.visual?.enabled === false) return suite(checkName, [], true, "disabled in config");

  const protoPath = resolve(projectRoot, config.prototype);
  const srcDir = resolve(projectRoot, config.implementation.src);
  const outputDir = resolve(projectRoot, config.visual?.outputDir ?? "visual-regression");
  const serverUrl = config.visual?.serverUrl ?? "http://localhost:5173";
  const devCommand = config.visual?.devCommand;
  const serverTimeout = config.visual?.serverTimeout ?? 30000;
  const viewports = config.visual?.viewports ?? [{ name: "desktop", width: 940, height: 800 }, { name: "mobile", width: 390, height: 844 }];
  const screens = config.visual?.screens ?? DEFAULT_SCREENS;
  const customStepFiles = config.visual?.customStepFiles;
  const skipList = new Set([...(config.globalSkipList ?? []), ...(config.visual?.skipClasses ?? [])]);

  if (!existsSync(protoPath)) return suite(checkName, [], true, `prototype not found: ${protoPath}`);

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
    } catch {}

    if (!serverReady && devCommand) {
      const [cmd, args] = parseCommand(devCommand);
      try {
        console.log(`  Starting dev server: ${devCommand}`);
        startedServer = spawn(cmd, args, { cwd: projectRoot, stdio: "ignore", detached: true });
        serverReady = await waitForServer(serverUrl, serverTimeout);
        if (serverReady) console.log(`  Dev server ready at ${serverUrl}`);
      } catch (e) { console.error(`  Failed to start dev server: ${e}`); }
    }

    if (serverReady) {
      mkdirSync(outputDir, { recursive: true });

      // Serve prototype over HTTP
      const protoDir = protoPath.replace(/[^/\\]+$/, "");
      const protoFileName = protoPath.replace(/^.*[/\\]/, "");
      const protoServerUrl = "http://localhost:9876";
      protoServer = spawn("npx", ["http-server", protoDir, "-p", "9876", "-s", "--cors"], { cwd: projectRoot, stdio: "ignore", detached: true });
      let protoReady = await waitForServer(protoServerUrl, 15000);
      if (!protoReady) {
        try { if (protoServer.pid) process.kill(-protoServer.pid, "SIGTERM"); } catch {}
        protoServer = spawn("python3", ["-m", "http.server", "9876"], { cwd: protoDir, stdio: "ignore", detached: true });
        protoReady = await waitForServer(protoServerUrl, 8000);
      }
      if (!protoReady) { console.log(`    [visual] could not serve prototype over HTTP`); try { if (protoServer.pid) process.kill(-protoServer.pid, "SIGTERM"); } catch {} protoServer = null; }

      // ─── Screenshots ─────────────────────────────────────────────
      for (const vp of viewports) {
        // Capture prototype screens
        const pBrowser = await playwright.chromium.launch();
        const pCtx = await pBrowser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const pPage = await pCtx.newPage();
        const protoUrl = protoReady ? `${protoServerUrl}/${protoFileName.replace(/ /g, "%20")}` : `file://${protoPath.replace(/ /g, "%20")}`;
        for (let i = 0; i < screens.length; i++) {
          const result = await navigateAndCapture(pPage, protoUrl, outputDir, "proto", vp.name, screens[i], i === 0);
          if (result) screenshotsTaken.push(result);
        }
        await pBrowser.close();

        // Capture React screens
        const rBrowser = await playwright.chromium.launch();
        const rCtx = await rBrowser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const rPage = await rCtx.newPage();
        for (let i = 0; i < screens.length; i++) {
          const result = await navigateAndCapture(rPage, serverUrl, outputDir, "react", vp.name, screens[i], i === 0, customStepFiles, projectRoot);
          if (result) screenshotsTaken.push(result);
        }
        await rBrowser.close();

        // Create side-by-side comparisons
        for (const screen of screens) {
          const protoImg = join(outputDir, `proto-${vp.name}-${screen.name}.png`);
          const reactImg = join(outputDir, `react-${vp.name}-${screen.name}.png`);
          const compareImg = join(outputDir, `compare-${vp.name}-${screen.name}.png`);
          const result = await createComparison(playwright, protoImg, reactImg, compareImg, vp.width);
          if (result) comparisonsCreated.push(result);
        }
      }

      // ─── Layout Diff ─────────────────────────────────────────────
      try {
        const layoutFailures: string[] = [];
        const layoutChecks = [];

        for (const screen of screens) {
          // Launch prototype browser
          const lpBrowser = await playwright.chromium.launch();
          const lpCtx = await lpBrowser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
          const lp = await lpCtx.newPage();
          const protoUrl = protoReady ? `${protoServerUrl}/${protoFileName.replace(/ /g, "%20")}` : `file://${protoPath.replace(/ /g, "%20")}`;
          await lp.goto(protoUrl, { waitUntil: "networkidle", timeout: 30000 });
          await sleep(3000);
          try { await lp.locator('button:has-text("I understand")').first().click({ timeout: 5000 }); await sleep(1000); } catch {}
          // Navigate to this screen
          const protoSteps = screen.steps ?? (screen.navText ? [{ click: screen.navText }] : []);
          for (const step of protoSteps) { await executeStep(lp, step, protoUrl, customStepFiles, projectRoot); }
          await sleep(1000);
          const protoLayout = await extractLayoutProps(lp);
          await lp.close();
          await lpBrowser.close();

          // Launch React browser
          const lrBrowser = await playwright.chromium.launch();
          const lrCtx = await lrBrowser.newContext({ viewport: { width: 1280, height: 800 } });
          const lrPage = await lrCtx.newPage();
          await lrPage.goto(serverUrl, { waitUntil: "networkidle", timeout: 30000 });
          await sleep(3000);
          try { await lrPage.locator('button:has-text("I understand")').first().click({ timeout: 5000 }); await sleep(1000); } catch {}
          const reactSteps = screen.steps ?? (screen.navText ? [{ click: screen.navText }] : []);
          for (const step of reactSteps) { await executeStep(lrPage, step, serverUrl, customStepFiles, projectRoot); }
          await sleep(1000);
          const reactLayout = await extractLayoutProps(lrPage);
          await lrPage.close();
          await lrBrowser.close();

          // Diff layout properties
          for (const key of Object.keys(protoLayout)) {
            if (protoLayout[key] === "N/A" || reactLayout[key] === "N/A") continue;
            const match = protoLayout[key] === reactLayout[key];
            layoutChecks.push(check(
              `layout:${screen.name}:${key}`,
              checkName,
              match,
              match ? `${screen.name} ${key} matches` : `${screen.name} ${key} mismatch: proto="${protoLayout[key]}" react="${reactLayout[key]}"`,
            ));
            if (!match) layoutFailures.push(`${screen.name} ${key}: proto="${protoLayout[key]}" react="${reactLayout[key]}"`);
          }
        }

        if (layoutFailures.length > 0) console.log(`\n  [layout-diff] ${layoutFailures.length} layout mismatches: ${layoutFailures.join(", ")}`);

        layoutChecks.push(check(
          "visual:layout-diff", checkName,
          layoutFailures.length === 0,
          layoutFailures.length === 0
            ? `All layout properties match across ${screens.length} screens`
            : `${layoutFailures.length} layout mismatches found`,
          layoutFailures.length === 0 ? "info" : "error",
        ));
        checks.push(...layoutChecks);
      } catch (e: unknown) {
        checks.push(check("visual:layout-error", checkName, false, `Layout diff failed: ${(e as Error).message}`));
      }

      // ─── Summary ────────────────────────────────────────────────
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
    checks.push(check("visual:screenshots", checkName, false, "Playwright not installed — screenshots skipped (run: npx playwright install chromium)", "warning"));
  }

  // DOM class diff (always runs, no dependencies)
  const protoClasses = extractPrototypeCssClasses(protoPath);
  const missing: string[] = [];
  for (const cls of protoClasses) { if (cls.length <= 2) continue; if (skipList.has(cls)) continue; if (!classInSource(cls, srcDir, skipList)) missing.push(cls); }
  checks.push(check(
    "visual:dom-diff", checkName,
    missing.length === 0,
    missing.length === 0
      ? `All ${protoClasses.size} prototype CSS classes found in implementation source`
      : `${missing.length} prototype CSS classes NOT found in implementation: ${missing.join(", ")}`,
  ));

  // Cleanup servers
  for (const srv of [startedServer, protoServer]) {
    if (srv) { try { if (srv.pid) process.kill(-srv.pid, "SIGTERM"); } catch {} }
  }

  return suite(checkName, checks);
}
