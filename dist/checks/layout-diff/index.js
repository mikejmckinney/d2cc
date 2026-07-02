// design-to-code-contract — Layout diff
// Compares computed CSS layout properties between prototype and implementation
// across all captured screens. Extracts gap, padding, border-radius, and other
// layout properties from both prototypes and React CSS, then diffs them.
// SPDX-License-Identifier: MIT
import { check, suite } from "../../core/reporter.js";
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
async function hasPlaywright() {
    try {
        await import("@playwright/test");
        return true;
    }
    catch {
        return false;
    }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function extractLayoutProps(page) {
    return page.evaluate(() => {
        const cs = (el, prop) => {
            if (!el)
                return "N/A";
            const val = getComputedStyle(el)[prop];
            return val != null ? String(val) : "N/A";
        };
        const elements = {
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
        const props = {};
        for (const [name, el] of Object.entries(elements)) {
            props[`${name}.padding`] = cs(el, "padding");
            props[`${name}.gap`] = cs(el, "gap");
            props[`${name}.borderRadius`] = cs(el, "borderRadius");
            props[`${name}.width`] = cs(el, "maxWidth");
        }
        return props;
    });
}
export async function runLayoutDiff(config, projectRoot, devServerUrl, protoServerUrl) {
    const checkName = "Layout Diff";
    if (!(await hasPlaywright())) {
        return suite(checkName, [], true, "Playwright not available — skipping layout diff", true);
    }
    const checks = [];
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const playwright = await import("@playwright/test");
        // Capture prototype layout
        const protoBrowser = await playwright.chromium.launch();
        const protoCtx = await protoBrowser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
        const protoPage = await protoCtx.newPage();
        await protoPage.goto(protoServerUrl, { waitUntil: "networkidle", timeout: 30000 });
        await sleep(3000);
        try {
            await protoPage.locator('button:has-text("I understand")').first().click({ timeout: 5000 });
            await sleep(1000);
        }
        catch { /* no overlay */ }
        const protoProps = await extractLayoutProps(protoPage);
        await protoPage.close();
        await protoBrowser.close();
        // Capture React layout
        const reactBrowser = await playwright.chromium.launch();
        const reactCtx = await reactBrowser.newContext({ viewport: { width: 1280, height: 800 } });
        const reactPage = await reactCtx.newPage();
        await reactPage.goto(devServerUrl, { waitUntil: "networkidle", timeout: 30000 });
        await sleep(3000);
        try {
            await reactPage.locator('button:has-text("I understand")').first().click({ timeout: 5000 });
            await sleep(1000);
        }
        catch { /* no overlay */ }
        const reactProps = await extractLayoutProps(reactPage);
        await reactPage.close();
        await reactBrowser.close();
        // Compare layout properties
        const layoutProps = [
            "header.padding", "header.gap",
            "headerInner.padding", "headerInner.gap",
            "nav.gap",
            "shell.padding", "shell.gap",
            "mainGrid.gap", "mainGrid.width",
            "card.padding", "card.borderRadius",
            "insight.borderRadius", "insight.padding", "insight.border",
            "expCard.borderRadius", "expCard.padding",
            "focusTrack.borderRadius",
            "optionLetter.borderRadius",
            "quickCard.borderRadius", "quickCard.padding",
        ];
        const failures = [];
        for (const prop of layoutProps) {
            const protoVal = protoProps[prop] ?? "N/A";
            const reactVal = reactProps[prop] ?? "N/A";
            const match = protoVal === reactVal;
            checks.push(check(`layout:${prop}`, checkName, match, match
                ? `${prop} matches: ${protoVal}`
                : `${prop} mismatch: proto="${protoVal}" react="${reactVal}"`));
            if (!match)
                failures.push(`${prop}: proto="${protoVal}" react="${reactVal}"`);
        }
        if (failures.length > 0) {
            console.log(`\n  [layout-diff] ${failures.length} layout mismatches:`);
            failures.forEach(f => console.log(`    ${f}`));
        }
    }
    catch (err) {
        checks.push(check("layout:error", checkName, false, `Layout diff failed: ${err.message}`));
    }
    return suite(checkName, checks);
}
//# sourceMappingURL=index.js.map