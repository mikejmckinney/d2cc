// design-to-code-contract — Skeleton extractor
// Extracts component skeletons from prototype HTML sections.
// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { check, suite } from "../../core/reporter.js";
/** Default section patterns for common prototype structures */
const DEFAULT_SECTIONS = [
    { name: "Header", pattern: '(<header class="header".*?</header>)' },
    {
        name: "ReadinessHero",
        pattern: '(<div class="readiness-hero".*?</div>\\s*</div>\\s*</div>)',
    },
    {
        name: "QuickStartGrid",
        pattern: '(<div class="qs-grid".*?</div>\\s*</div>)',
    },
    {
        name: "CategoryBreakdown",
        pattern: '(<div class="cat-section".*?</div>\\s*</div>\\s*</div>)',
    },
    {
        name: "AmIReadyInsights",
        pattern: '(<div class="insights".*?</div>\\s*</div>\\s*</div>)',
    },
    { name: "StudyPlan", pattern: '(<div class="plan-card".*?</div>\\s*</div>)' },
    {
        name: "SessionHistory",
        pattern: '(<div class="history-card".*?</div>\\s*</div>\\s*</div>)',
    },
];
/**
 * Extract sections from prototype HTML using regex patterns.
 */
export function extractSections(protoPath, sections) {
    if (!existsSync(protoPath)) {
        throw new Error(`Prototype not found: ${protoPath}`);
    }
    const html = readFileSync(protoPath, "utf-8");
    const results = [];
    for (const { name, pattern } of sections) {
        try {
            const regex = new RegExp(pattern, "ds");
            const match = regex.exec(html);
            if (match) {
                let snippet = match[1].trim();
                const lines = snippet.split("\n");
                const truncated = lines.length > 60;
                if (truncated) {
                    snippet =
                        lines.slice(0, 60).join("\n") +
                            "\n  <!-- ... truncated, see prototype for full markup -->";
                }
                results.push({
                    name,
                    found: true,
                    snippet,
                    lineCount: lines.length,
                });
            }
            else {
                results.push({ name, found: false, snippet: "", lineCount: 0 });
            }
        }
        catch {
            results.push({ name, found: false, snippet: "", lineCount: 0 });
        }
    }
    return results;
}
/**
 * Render section results as a Markdown document.
 */
export function renderSkeletons(sections, protoPath) {
    const lines = [
        "# Component Skeletons",
        "",
        "Generated from prototype HTML. Each section below shows the **exact markup**",
        "that the React component must reproduce. Class names are the contract —",
        "do not rename or restructure.",
        "",
        "## How to use",
        "1. For each section below, create a React component that renders the exact HTML structure.",
        "2. Use the class names verbatim — the CSS depends on them.",
        "3. Wire interactivity after the static structure matches.",
        "",
        "---",
        "",
    ];
    for (const sec of sections) {
        lines.push(`### ${sec.name}`);
        lines.push("");
        if (sec.found) {
            lines.push("```html");
            lines.push(sec.snippet);
            lines.push("```");
            lines.push("");
            lines.push(`**React component**: \`${sec.name}.tsx\``);
            lines.push(`**Source**: \`${protoPath}\``);
        }
        else {
            lines.push(`⚠️ Section not found in prototype — extract manually from \`${protoPath}\``);
        }
        lines.push("");
        lines.push("---");
        lines.push("");
    }
    return lines.join("\n");
}
/**
 * Run the skeleton extraction check.
 */
export function runSkeleton(config, projectRoot) {
    const checkName = "Prototype Section Skeletons";
    if (config.skeleton?.enabled === false) {
        return suite(checkName, [], true, "disabled in config");
    }
    const protoPath = resolve(projectRoot, config.prototype);
    if (!existsSync(protoPath)) {
        return suite(checkName, [], true, `prototype not found: ${protoPath}`);
    }
    const sections = config.skeleton?.sections ?? DEFAULT_SECTIONS;
    const results = extractSections(protoPath, sections);
    const checks = [];
    for (const sec of results) {
        checks.push(check(`skeleton:${sec.name}`, checkName, sec.found, sec.found
            ? `${sec.name} extracted (${sec.lineCount} lines)`
            : `${sec.name} not found in prototype`, sec.found ? "info" : "warning"));
    }
    // Write output file
    const outputPath = resolve(projectRoot, config.skeleton?.output ?? "component-skeletons.md");
    const content = renderSkeletons(results, protoPath);
    writeFileSync(outputPath, content, "utf-8");
    return suite(checkName, checks);
}
//# sourceMappingURL=index.js.map