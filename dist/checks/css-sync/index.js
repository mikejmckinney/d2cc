// design-to-code-contract — CSS Sync checker
// Extracts CSS styles from the prototype via three sources:
//   1. Class selectors from <style> blocks
//   2. CSS custom properties from inline style="..." attributes
//   3. CSS custom properties from JS THEME objects
// Verifies classes exist and token values match in the implementation CSS.
// SPDX-License-Identifier: MIT
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { check, suite } from "../../core/reporter.js";
// ─── Extraction: <style> block classes (original) ───
export function extractPrototypeClasses(protoPath) {
    if (!existsSync(protoPath)) {
        throw new Error(`Prototype not found: ${protoPath}`);
    }
    const html = readFileSync(protoPath, "utf-8");
    const classes = new Set();
    const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let styleMatch;
    while ((styleMatch = styleRegex.exec(html)) !== null) {
        const block = styleMatch[1];
        const classRegex = /\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
        let classMatch;
        while ((classMatch = classRegex.exec(block)) !== null) {
            classes.add(classMatch[1]);
        }
    }
    return [...classes].sort();
}
// ─── Extraction: className="..." attributes from HTML ───
export function extractPrototypeClassNames(protoPath) {
    if (!existsSync(protoPath)) {
        throw new Error(`Prototype not found: ${protoPath}`);
    }
    const html = readFileSync(protoPath, "utf-8");
    const classes = new Set();
    const classAttrRegex = /(?:class|className)="([^"]*)"/gi;
    let match;
    while ((match = classAttrRegex.exec(html)) !== null) {
        const classStr = match[1];
        for (const cls of classStr.split(/\s+/)) {
            const trimmed = cls.trim();
            if (trimmed && /^[a-zA-Z]/.test(trimmed)) {
                classes.add(trimmed);
            }
        }
    }
    return [...classes].sort();
}
export function extractInlineTokens(protoPath) {
    if (!existsSync(protoPath)) {
        throw new Error(`Prototype not found: ${protoPath}`);
    }
    const html = readFileSync(protoPath, "utf-8");
    const tokens = [];
    const seen = new Set();
    // Match style="..." attributes
    const styleAttrRegex = /style="([^"]*)"/gi;
    let match;
    while ((match = styleAttrRegex.exec(html)) !== null) {
        const styleContent = match[1];
        // Extract --var:value pairs (allow rgba(), hex, etc.)
        const tokenRegex = /(--[a-zA-Z][a-zA-Z0-9-]*)\s*:\s*([^;]+)/g;
        let tokenMatch;
        while ((tokenMatch = tokenRegex.exec(styleContent)) !== null) {
            const name = tokenMatch[1];
            const value = tokenMatch[2].trim();
            if (!seen.has(name)) {
                seen.add(name);
                tokens.push({ name, value, source: "inline-attr" });
            }
        }
    }
    return tokens;
}
// ─── Extraction: JS THEME object tokens ───
export function extractJsThemeTokens(protoPath) {
    if (!existsSync(protoPath)) {
        throw new Error(`Prototype not found: ${protoPath}`);
    }
    const html = readFileSync(protoPath, "utf-8");
    const result = {};
    // Find THEME = { ... } using brace counting
    const themeStart = html.indexOf("THEME");
    if (themeStart === -1)
        return result;
    const eqIndex = html.indexOf("{", themeStart);
    if (eqIndex === -1)
        return result;
    let depth = 0;
    let themeEnd = -1;
    for (let i = eqIndex; i < html.length; i++) {
        if (html[i] === "{")
            depth++;
        if (html[i] === "}") {
            depth--;
            if (depth === 0) {
                themeEnd = i;
                break;
            }
        }
    }
    if (themeEnd === -1)
        return result;
    const themeBody = html.slice(eqIndex + 1, themeEnd);
    // Find each theme variant: name: { ... }
    const variantRegex = /(\w+)\s*:\s*\{/g;
    let variantMatch;
    while ((variantMatch = variantRegex.exec(themeBody)) !== null) {
        const themeName = variantMatch[1];
        const variantStart = variantMatch.index + variantMatch[0].length - 1;
        let vDepth = 0;
        let variantEnd = -1;
        for (let i = variantStart; i < themeBody.length; i++) {
            if (themeBody[i] === "{")
                vDepth++;
            if (themeBody[i] === "}") {
                vDepth--;
                if (vDepth === 0) {
                    variantEnd = i;
                    break;
                }
            }
        }
        if (variantEnd === -1)
            continue;
        const variantBody = themeBody.slice(variantStart + 1, variantEnd);
        const tokens = [];
        const seen = new Set();
        const tokenRegex = /['"]?(--[a-zA-Z][a-zA-Z0-9-]*)['"]?\s*:\s*['"]([^'"]+)['"]/g;
        let tokenMatch;
        while ((tokenMatch = tokenRegex.exec(variantBody)) !== null) {
            const name = tokenMatch[1];
            const value = tokenMatch[2].trim();
            if (!seen.has(name)) {
                seen.add(name);
                tokens.push({ name, value, source: "js-object" });
            }
        }
        if (tokens.length > 0) {
            result[themeName] = tokens;
        }
    }
    return result;
}
// ─── Comparison helpers ───
export function classExistsInCss(className, cssPath) {
    if (!existsSync(cssPath))
        return false;
    const css = readFileSync(cssPath, "utf-8");
    const pattern = new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s{,:+>~\\[]`);
    return pattern.test(css);
}
/**
 * Normalize rgba values for comparison:
 * rgba(255,253,249,.86) == rgba(255, 253, 249, 0.86)
 */
function normalizeValue(v) {
    let s = v.replace(/\s+/g, "").toLowerCase();
    s = s.replace(/rgba?\((\d+),(\d+),(\d+),0\.(\d+)\)/, "rgba($1,$2,$3,.$4)");
    return s;
}
export function tokenExistsInCss(tokenName, expectedValue, cssPath, selectorBlock) {
    if (!existsSync(cssPath))
        return { exists: false, actualValue: null };
    const css = readFileSync(cssPath, "utf-8");
    let searchRegion = css;
    if (selectorBlock) {
        const escapedSelector = selectorBlock.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const blockRegex = new RegExp(escapedSelector + "\\s*\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\}");
        const blockMatch = blockRegex.exec(css);
        if (blockMatch) {
            searchRegion = blockMatch[1];
        }
        else {
            return { exists: false, actualValue: null };
        }
    }
    const escapedName = tokenName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tokenRegex = new RegExp(escapedName + "\\s*:\\s*([^;]+)");
    const tokenMatch = tokenRegex.exec(searchRegion);
    if (!tokenMatch)
        return { exists: false, actualValue: null };
    const actualValue = tokenMatch[1].trim();
    const exists = normalizeValue(actualValue) === normalizeValue(expectedValue);
    return { exists, actualValue };
}
// ─── Runner ───
export function runCssSync(config, projectRoot) {
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
    const checks = [];
    // ── Source 1: <style> block class selectors ──
    const protoClasses = extractPrototypeClasses(protoPath);
    for (const cls of protoClasses) {
        if (skipList.has(cls))
            continue;
        const exists = classExistsInCss(cls, cssPath);
        checks.push(check(`css-sync:style-block:${cls}`, checkName, exists, exists
            ? `.${cls} defined in implementation CSS`
            : `.${cls} defined in prototype <style> but NOT in implementation CSS`));
    }
    // ── Source 2: inline style="..." CSS custom properties → :root ──
    const inlineTokens = extractInlineTokens(protoPath);
    for (const token of inlineTokens) {
        if (skipList.has(token.name))
            continue;
        const result = tokenExistsInCss(token.name, token.value, cssPath, ":root");
        checks.push(check(`css-sync:inline:${token.name}`, checkName, result.exists, result.exists
            ? `${token.name}: ${token.value} — matches :root`
            : `${token.name}: expected "${token.value}" but ${result.actualValue
                ? `found "${result.actualValue}" in :root`
                : "not defined in :root"}`));
    }
    // ── Source 3: JS THEME object tokens ──
    const jsThemeTokens = extractJsThemeTokens(protoPath);
    for (const [themeName, tokens] of Object.entries(jsThemeTokens)) {
        let selectorBlock;
        if (themeName === "day") {
            selectorBlock = ":root";
        }
        else if (themeName === "night") {
            selectorBlock = '[data-theme="night"]';
        }
        for (const token of tokens) {
            if (skipList.has(token.name))
                continue;
            const result = tokenExistsInCss(token.name, token.value, cssPath, selectorBlock);
            checks.push(check(`css-sync:theme:${themeName}:${token.name}`, checkName, result.exists, result.exists
                ? `${token.name}: ${token.value} — matches ${themeName} block`
                : `${token.name}: expected "${token.value}" in ${themeName} but ${result.actualValue
                    ? `found "${result.actualValue}"`
                    : "not defined"}`));
        }
    }
    return suite(checkName, checks);
}
//# sourceMappingURL=index.js.map