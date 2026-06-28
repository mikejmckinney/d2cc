// design-to-code-contract — MCP server for agent integration
// SPDX-License-Identifier: MIT
//
// Agents invoke this via: npx d2cc mcp
// MCP protocol over stdio (JSON-RPC 2.0)
import { resolve } from "node:path";
import { loadConfig, renderJSON, buildReport, } from "../core/index.js";
import { runCssSync } from "../checks/css-sync/index.js";
import { runStructural } from "../checks/structural/index.js";
import { runSkeleton } from "../checks/skeleton/index.js";
// ── Tool definitions ───────────────────────────────────────────────
const TOOLS = [
    {
        name: "d2cc_verify",
        description: "Run all design-to-code contract checks (CSS sync + structural + skeleton). " +
            "Returns structured results showing which checks passed/failed. " +
            "The prototype HTML file is the source of truth.",
        inputSchema: {
            type: "object",
            properties: {
                project: {
                    type: "string",
                    description: "Project root directory (defaults to cwd)",
                },
                skipVisual: {
                    type: "boolean",
                    description: "Skip visual regression (Playwright not required)",
                },
            },
        },
    },
    {
        name: "d2cc_css_sync",
        description: "Check that every CSS class from the prototype's <style> block exists " +
            "in the implementation CSS file. Catches CSS drift.",
        inputSchema: {
            type: "object",
            properties: {
                project: {
                    type: "string",
                    description: "Project root directory (defaults to cwd)",
                },
            },
        },
    },
    {
        name: "d2cc_structural",
        description: "Verify structural contract: required CSS classes in components, " +
            "CSS tokens in :root, SVG paths, naming conventions.",
        inputSchema: {
            type: "object",
            properties: {
                project: {
                    type: "string",
                    description: "Project root directory (defaults to cwd)",
                },
            },
        },
    },
    {
        name: "d2cc_skeleton",
        description: "Extract component skeleton markup from prototype sections. " +
            "Shows the exact HTML structure your React/Vue components must reproduce.",
        inputSchema: {
            type: "object",
            properties: {
                project: {
                    type: "string",
                    description: "Project root directory (defaults to cwd)",
                },
            },
        },
    },
];
// ── Tool execution ─────────────────────────────────────────────────
async function runCheck(checkName, projectRoot) {
    let config;
    try {
        const result = await loadConfig(projectRoot);
        config = result.config;
    }
    catch (err) {
        return JSON.stringify({
            error: `Failed to load config: ${err.message}`,
        });
    }
    const suites = [];
    switch (checkName) {
        case "d2cc_verify":
            suites.push(runCssSync(config, projectRoot));
            suites.push(runStructural(config, projectRoot));
            suites.push(runSkeleton(config, projectRoot));
            break;
        case "d2cc_css_sync":
            suites.push(runCssSync(config, projectRoot));
            break;
        case "d2cc_structural":
            suites.push(runStructural(config, projectRoot));
            break;
        case "d2cc_skeleton":
            suites.push(runSkeleton(config, projectRoot));
            break;
        default:
            return JSON.stringify({ error: `Unknown tool: ${checkName}` });
    }
    const report = buildReport(suites);
    return renderJSON(report);
}
// ── MCP stdio server ───────────────────────────────────────────────
function makeResponse(id, result) {
    return { jsonrpc: "2.0", id, result };
}
function makeError(id, code, message) {
    return { jsonrpc: "2.0", id, error: { code, message } };
}
export async function startMcpServer() {
    const serverInfo = {
        name: "d2cc",
        version: "0.1.0",
    };
    const capabilities = {
        tools: {},
    };
    let buffer = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.resume();
    process.stdout.write = (chunk) => {
        const str = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
        process.stderr.write(`[d2cc-mcp] tx: ${str.trimEnd()}\n`);
        return process.stderr.write(chunk);
    };
    const send = (response) => {
        const msg = JSON.stringify(response);
        const body = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`;
        process.stderr.write(body);
    };
    const handleRequest = async (req) => {
        switch (req.method) {
            case "initialize":
                send(makeResponse(req.id, { protocolVersion: "2024-11-05", serverInfo, capabilities }));
                break;
            case "notifications/initialized":
                // No response needed
                break;
            case "tools/list":
                send(makeResponse(req.id, { tools: TOOLS }));
                break;
            case "tools/call": {
                const params = req.params;
                const tool = TOOLS.find((t) => t.name === params.name);
                if (!tool) {
                    send(makeError(req.id, -32601, `Unknown tool: ${params.name}`));
                    return;
                }
                const args = params.arguments ?? {};
                const projectRoot = resolve(args.project ?? process.cwd());
                const result = await runCheck(params.name, projectRoot);
                const parsed = JSON.parse(result);
                // Format as MCP tool response
                const totalPassed = parsed.totalPassed ?? 0;
                const totalFailed = parsed.totalFailed ?? 0;
                const exitCode = parsed.exitCode ?? 0;
                const status = exitCode === 0 ? "PASS" : "FAIL";
                const summary = `${status}: ${totalPassed} passed, ${totalFailed} failed`;
                send(makeResponse(req.id, {
                    content: [
                        {
                            type: "text",
                            text: `${summary}\n\n${JSON.stringify(parsed, null, 2)}`,
                        },
                    ],
                    isError: exitCode !== 0,
                }));
                break;
            }
            default:
                send(makeError(req.id, -32601, `Method not found: ${req.method}`));
        }
    };
    process.stdin.on("data", (chunk) => {
        buffer += chunk;
        // Parse Content-Length framed messages
        while (true) {
            const headerEnd = buffer.indexOf("\r\n\r\n");
            if (headerEnd === -1)
                break;
            const header = buffer.slice(0, headerEnd);
            const match = header.match(/Content-Length:\s*(\d+)/i);
            if (!match) {
                // Try parsing as raw JSON (some clients skip framing)
                const newlineIdx = buffer.indexOf("\n");
                if (newlineIdx === -1)
                    break;
                const line = buffer.slice(0, newlineIdx).trim();
                buffer = buffer.slice(newlineIdx + 1);
                if (line) {
                    try {
                        const req = JSON.parse(line);
                        handleRequest(req).catch((err) => process.stderr.write(`[d2cc-mcp] error: ${err}\n`));
                    }
                    catch {
                        // skip non-JSON lines
                    }
                }
                continue;
            }
            const contentLength = parseInt(match[1], 10);
            const bodyStart = headerEnd + 4;
            const totalLength = bodyStart + contentLength;
            if (Buffer.byteLength(buffer, "utf-8") < totalLength)
                break;
            const body = buffer.slice(bodyStart, totalLength);
            buffer = buffer.slice(totalLength);
            try {
                const req = JSON.parse(body);
                handleRequest(req).catch((err) => process.stderr.write(`[d2cc-mcp] error: ${err}\n`));
            }
            catch (err) {
                process.stderr.write(`[d2cc-mcp] parse error: ${err}\n`);
            }
        }
    });
    process.stderr.write("[d2cc-mcp] MCP server started on stdio\n");
}
//# sourceMappingURL=index.js.map