// design-to-code-contract — Structural verifier
// Checks that the implementation uses the correct CSS classes, tokens,
// SVG paths, structural patterns, and naming conventions.
// SPDX-License-Identifier: MIT
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { check, suite } from "../../core/reporter.js";
function fileContains(filePath, pattern) {
    if (!existsSync(filePath))
        return false;
    const content = readFileSync(filePath, "utf-8");
    return content.includes(pattern);
}
function fileMatchesRegex(filePath, pattern) {
    if (!existsSync(filePath))
        return false;
    const content = readFileSync(filePath, "utf-8");
    return pattern.test(content);
}
/**
 * Run the structural verification check.
 */
export function runStructural(config, projectRoot) {
    const checkName = "Structural Verification";
    if (config.structural?.enabled === false) {
        return suite(checkName, [], true, "disabled in config");
    }
    const srcDir = resolve(projectRoot, config.implementation.src);
    const cssPath = resolve(projectRoot, config.implementation.css);
    const checks = [];
    // 1. Check CSS classes used in components
    if (config.structural?.components) {
        for (const [file, classes] of Object.entries(config.structural.components)) {
            const filePath = join(srcDir, "components", file);
            for (const cls of classes) {
                const exists = fileContains(filePath, cls);
                checks.push(check(`struct:cls:${file}:${cls}`, checkName, exists, exists
                    ? `${file} uses class '${cls}'`
                    : `${file} does NOT use class '${cls}'`));
            }
        }
    }
    // 2. Check CSS tokens defined in :root
    if (config.structural?.requiredTokens) {
        for (const token of config.structural.requiredTokens) {
            const pattern = new RegExp(`^\\s*${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`, "m");
            const exists = fileMatchesRegex(cssPath, pattern);
            checks.push(check(`struct:token:${token}`, checkName, exists, exists
                ? `Token ${token} defined in CSS`
                : `Token ${token} NOT defined in CSS`));
        }
    }
    // 3. Check dark mode block
    if (config.structural?.patterns) {
        for (const [id, { file, pattern }] of Object.entries(config.structural.patterns)) {
            const filePath = file.includes("/") || file.includes("\\")
                ? resolve(projectRoot, file)
                : join(srcDir, "components", file);
            const exists = fileContains(filePath, pattern);
            checks.push(check(`struct:pattern:${id}`, checkName, exists, exists
                ? `Pattern '${pattern}' found in ${file}`
                : `Pattern '${pattern}' NOT found in ${file}`));
        }
    }
    // 4. Check SVG paths
    if (config.structural?.svgPaths) {
        for (const [name, path] of Object.entries(config.structural.svgPaths)) {
            // Search all component files for this SVG path
            let found = false;
            try {
                const compDir = join(srcDir, "components");
                if (existsSync(compDir)) {
                    const files = readdirSync(compDir).filter((f) => f.endsWith(".tsx"));
                    for (const f of files) {
                        if (fileContains(join(compDir, f), path)) {
                            found = true;
                            break;
                        }
                    }
                }
            }
            catch {
                // directory read failed
            }
            checks.push(check(`struct:svg:${name}`, checkName, found, found
                ? `SVG path '${name}' found in components`
                : `SVG path '${name}' NOT found in any component`));
        }
    }
    return suite(checkName, checks);
}
//# sourceMappingURL=index.js.map