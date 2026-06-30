// design-to-code-contract — MCP server for agent integration
// SPDX-License-Identifier: MIT
//
// Agents invoke this via: npx d2cc mcp
// MCP protocol over stdio (JSON-RPC 2.0)

import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  loadConfig,
  renderJSON,
  buildReport,
} from "../core/index.js";
import { runCssSync } from "../checks/css-sync/index.js";
import { runStructural } from "../checks/structural/index.js";
import { runSkeleton } from "../checks/skeleton/index.js";
import { runVisual } from "../checks/visual/index.js";
import type { SuiteResult, ContractConfig } from "../core/types.js";

// ── MCP protocol helpers ───────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ── Tool definitions ───────────────────────────────────────────────

const TOOLS: McpTool[] = [
  {
    name: "d2cc_verify",
    description:
      "Run all design-to-code contract checks (CSS sync + structural + skeleton). " +
      "Visual check is skipped by default (takes 5-10min). Use d2cc_visual separately. " +
      "Returns structured results showing which checks passed/failed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project: {
          type: "string",
          description: "Project root directory (defaults to cwd)",
        },
        includeVisual: {
          type: "boolean",
          description: "Include visual regression check (slow, 5-10min). Default: false.",
        },
      },
    },
  },
  {
    name: "d2cc_css_sync",
    description:
      "Check that CSS custom properties and class selectors from the prototype " +
      "match the implementation CSS. Extracts from style blocks, inline style attributes, " +
      "and JS THEME objects. Catches CSS drift and token mismatches.",
    inputSchema: {
      type: "object" as const,
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
    description:
      "Verify structural contract: required CSS classes in components, " +
      "CSS tokens in :root, SVG paths, naming conventions.",
    inputSchema: {
      type: "object" as const,
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
    description:
      "Extract component skeleton markup from prototype sections. " +
      "Shows the exact HTML structure your React/Vue components must reproduce.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project: {
          type: "string",
          description: "Project root directory (defaults to cwd)",
        },
      },
    },
  },
  {
    name: "d2cc_visual",
    description:
      "Capture screenshots of prototype and implementation using Playwright, " +
      "navigate through configured screens with multi-step sequences, " +
      "and generate side-by-side comparisons. Requires Playwright chromium.",
    inputSchema: {
      type: "object" as const,
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

async function runCheck(
  checkName: string,
  projectRoot: string,
  args?: Record<string, unknown>,
): Promise<string> {
  let config: ContractConfig;
  try {
    const result = await loadConfig(projectRoot);
    config = result.config;
  } catch (err: unknown) {
    return JSON.stringify({
      error: `Failed to load config: ${(err as Error).message}`,
    });
  }

  const suites: SuiteResult[] = [];

  switch (checkName) {
    case "d2cc_verify":
      suites.push(runCssSync(config, projectRoot));
      suites.push(runStructural(config, projectRoot));
      suites.push(runSkeleton(config, projectRoot));
      if (!(args?.skipVisual)) suites.push(await runVisual(config, projectRoot));
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
    case "d2cc_visual":
      suites.push(await runVisual(config, projectRoot));
      break;
    default:
      return JSON.stringify({ error: `Unknown tool: ${checkName}` });
  }

  const report = buildReport(suites);
  return renderJSON(report);
}

// ── MCP stdio server ───────────────────────────────────────────────

function makeResponse(id: number, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function makeError(id: number, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export async function startMcpServer(): Promise<void> {
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

  const send = (response: JsonRpcResponse): void => {
    const msg = JSON.stringify(response) + "\n";
    process.stdout.write(msg);
  };

  const handleRequest = async (req: JsonRpcRequest): Promise<void> => {
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
        const params = req.params as { name: string; arguments?: Record<string, unknown> };
        const tool = TOOLS.find((t) => t.name === params.name);
        if (!tool) {
          send(makeError(req.id, -32601, `Unknown tool: ${params.name}`));
          return;
        }
        const args = params.arguments ?? {};
        const projectRoot = resolve((args.project as string) ?? process.cwd());
        const result = await runCheck(params.name, projectRoot, args);
        const parsed = JSON.parse(result) as Record<string, unknown>;

        // Format as MCP tool response
        const totalPassed = (parsed.totalPassed as number) ?? 0;
        const totalFailed = (parsed.totalFailed as number) ?? 0;
        const exitCode = (parsed.exitCode as number) ?? 0;
        const status = exitCode === 0 ? "PASS" : "FAIL";
        const summary = `${status}: ${totalPassed} passed, ${totalFailed} failed`;

        send(
          makeResponse(req.id, {
            content: [
              {
                type: "text",
                text: `${summary}\n\n${JSON.stringify(parsed, null, 2)}`,
              },
            ],
            isError: exitCode !== 0,
          }),
        );
        break;
      }

      default:
        send(makeError(req.id, -32601, `Method not found: ${req.method}`));
    }
  };

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;

    // Parse Content-Length framed messages, with raw JSON fallback
    while (buffer.length > 0) {
      const headerEnd = buffer.indexOf("\r\n\r\n");

      if (headerEnd !== -1) {
        const header = buffer.slice(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);

        if (match) {
          const contentLength = parseInt(match[1], 10);
          const bodyStart = headerEnd + 4;
          const totalLength = bodyStart + contentLength;

          if (Buffer.byteLength(buffer, "utf-8") < totalLength) break;

          const body = buffer.slice(bodyStart, totalLength);
          buffer = buffer.slice(totalLength);

          try {
            const req = JSON.parse(body) as JsonRpcRequest;
            handleRequest(req).catch((err) =>
              process.stderr.write(`[d2cc-mcp] error: ${err}\n`),
            );
          } catch (err) {
            process.stderr.write(`[d2cc-mcp] parse error: ${err}\n`);
          }
          continue;
        }
      }

      // Try raw JSON line (no Content-Length framing)
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx === -1) break;
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (line) {
        try {
          const req = JSON.parse(line) as JsonRpcRequest;
          handleRequest(req).catch((err) =>
            process.stderr.write(`[d2cc-mcp] error: ${err}\n`),
          );
        } catch {
          // skip non-JSON lines
        }
      }
    }
  });

  process.stderr.write("[d2cc-mcp] MCP server started on stdio\n");
}
