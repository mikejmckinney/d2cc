#!/usr/bin/env node
// design-to-code-contract — CLI entry point
// SPDX-License-Identifier: MIT
import { Command } from "commander";
import { resolve } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { loadConfig, generateDefaultConfig, renderText, renderJSON, buildReport, } from "../core/index.js";
import { runCssSync } from "../checks/css-sync/index.js";
import { runStructural } from "../checks/structural/index.js";
import { runSkeleton } from "../checks/skeleton/index.js";
import { runVisual } from "../checks/visual/index.js";
const program = new Command();
program
    .name("d2cc")
    .description("Design-to-code contract enforcement. Prototypes are the source of truth.")
    .version("0.1.0");
program
    .command("init")
    .description("Generate a default design-contract.config.js in the current directory")
    .action(() => {
    const configPath = resolve(process.cwd(), "design-contract.config.js");
    if (existsSync(configPath)) {
        console.error(`Config already exists: ${configPath}`);
        console.error("Delete it first, or edit it directly.");
        process.exit(1);
    }
    writeFileSync(configPath, generateDefaultConfig(), "utf-8");
    console.log(`Created ${configPath}`);
    console.log("Edit the file to configure your prototype, CSS, and check settings.");
});
program
    .command("verify")
    .description("Run all contract checks (CSS sync + structural + skeleton + visual)")
    .option("-p, --project <path>", "Project root directory", process.cwd())
    .option("--json", "Output as JSON instead of text")
    .option("--skip-visual", "Skip visual regression checks (no Playwright required)")
    .action(async (opts) => {
    const projectRoot = resolve(opts.project);
    let config;
    try {
        const result = await loadConfig(projectRoot);
        config = result.config;
        if (result.configPath) {
            console.error(`Config: ${result.configPath}`);
        }
        else {
            console.error("No config file found — using defaults");
        }
    }
    catch (err) {
        console.error(`Failed to load config: ${err.message}`);
        process.exit(1);
    }
    if (opts.skipVisual && config.visual) {
        config.visual.enabled = false;
    }
    const suites = [];
    // Run checks sequentially — each is independent
    suites.push(runCssSync(config, projectRoot));
    suites.push(runStructural(config, projectRoot));
    suites.push(runSkeleton(config, projectRoot));
    suites.push(await runVisual(config, projectRoot));
    const report = buildReport(suites);
    if (opts.json) {
        console.log(renderJSON(report));
    }
    else {
        console.log(renderText(report));
    }
    process.exit(report.exitCode);
});
// Individual check commands
program
    .command("css-sync")
    .description("Run CSS sync check only")
    .option("-p, --project <path>", "Project root directory", process.cwd())
    .option("--json", "Output as JSON")
    .action(async (opts) => {
    const projectRoot = resolve(opts.project);
    const { config } = await loadConfig(projectRoot);
    const result = runCssSync(config, projectRoot);
    const report = buildReport([result]);
    if (opts.json)
        console.log(renderJSON(report));
    else
        console.log(renderText(report));
    process.exit(report.exitCode);
});
program
    .command("structural")
    .description("Run structural verification only")
    .option("-p, --project <path>", "Project root directory", process.cwd())
    .option("--json", "Output as JSON")
    .action(async (opts) => {
    const projectRoot = resolve(opts.project);
    const { config } = await loadConfig(projectRoot);
    const result = runStructural(config, projectRoot);
    const report = buildReport([result]);
    if (opts.json)
        console.log(renderJSON(report));
    else
        console.log(renderText(report));
    process.exit(report.exitCode);
});
program
    .command("skeleton")
    .description("Extract component skeletons from prototype")
    .option("-p, --project <path>", "Project root directory", process.cwd())
    .option("--json", "Output as JSON")
    .action(async (opts) => {
    const projectRoot = resolve(opts.project);
    const { config } = await loadConfig(projectRoot);
    const result = runSkeleton(config, projectRoot);
    const report = buildReport([result]);
    if (opts.json)
        console.log(renderJSON(report));
    else
        console.log(renderText(report));
    process.exit(report.exitCode);
});
program
    .command("visual")
    .description("Run visual regression check only")
    .option("-p, --project <path>", "Project root directory", process.cwd())
    .option("--json", "Output as JSON")
    .action(async (opts) => {
    const projectRoot = resolve(opts.project);
    const { config } = await loadConfig(projectRoot);
    const result = await runVisual(config, projectRoot);
    const report = buildReport([result]);
    if (opts.json)
        console.log(renderJSON(report));
    else
        console.log(renderText(report));
    process.exit(report.exitCode);
});
program
    .command("mcp")
    .description("Start MCP server for agent integration (stdio transport)")
    .action(async () => {
    const { startMcpServer } = await import("../mcp/index.js");
    await startMcpServer();
});
program.parse();
//# sourceMappingURL=index.js.map