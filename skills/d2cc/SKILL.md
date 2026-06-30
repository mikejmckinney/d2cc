---
name: d2cc
description: Design-to-code contract enforcement — verify implementation matches a prototype HTML file. Use when working on UI/CSS changes, visual redesigns, or before PRs that touch styling or component structure.
license: MIT
---

# d2cc — Design-to-Code Contract Enforcement

d2cc verifies your implementation matches a prototype. The prototype is the source of truth.

## Install

```bash
npm install -D design-to-code-contract
npx playwright install chromium   # for visual checks
```

## When to use this skill

Load this skill when:
- Working on UI, CSS, or visual redesign tasks
- After making changes to component styles or layout
- Before opening a PR that touches styling
- When the user asks to verify visual fidelity against a prototype

## Enforcement workflow

The prototype is the single source of truth. The implementation must match it — not re-interpret it.

Follow this workflow when implementing a redesign:

1. **Read the prototype** before writing any component. Understand the markup structure, CSS classes, and token values.
2. **Port CSS verbatim** — copy the prototype's `<style>` block into your implementation CSS as the first step. Do not write new CSS alongside new components.
3. **Build components to match prototype markup** — the JSX must render the same HTML structure and class names the prototype uses. Translate, don't re-imagine.
4. **Run `d2cc css-sync` after each component** to verify all prototype CSS classes are present in your implementation CSS. Fix drift immediately — do not defer.
5. **Run `d2cc verify` before every commit** that touches styling, components, or layout. Exit code 0 = ship. Exit code 1 = fix before proceeding.

**Failure policy: fix immediately, never defer.** A failing check means the implementation has drifted from the prototype. Do not commit, do not move to the next component, do not mark a task complete — fix the failure first. Deferred drift compounds into the exact visual mismatch d2cc is designed to prevent.

## How to run

```bash
# Run all checks
npx d2cc verify

# Run all checks, output JSON (for CI or programmatic consumers)
npx d2cc verify --json

# Run individual checks
npx d2cc css-sync      # CSS custom properties + class selectors
npx d2cc structural    # required tokens, patterns, component classes
npx d2cc skeleton      # HTML structure extraction from prototype
npx d2cc visual        # multi-screen Playwright screenshots + comparisons
```

Use `-p <path>` to specify a project root (defaults to cwd):
```bash
npx d2cc verify -p /path/to/project
```

## Setup

Run `npx d2cc init` to generate a `design-contract.config.js` in your project root, then customize it:

```js
export default {
  prototype: "prototype.html",
  implementation: {
    src: "src",
    css: "src/app.css",
  },
  cssSync: { enabled: true, skipList: [] },
  structural: {
    enabled: true,
    requiredTokens: ["--bg", "--surface", "--ink", "--muted"],
    patterns: {
      "dark-mode": { file: "src/app.css", pattern: '[data-theme="night"]' },
    },
  },
  skeleton: { enabled: true, output: "component-skeletons.md" },
  visual: {
    enabled: true,
    serverUrl: "http://localhost:5173",
    devCommand: "npm run dev",
    viewports: [
      { name: "desktop", width: 1280, height: 800 },
      { name: "mobile", width: 390, height: 844 },
    ],
    outputDir: "visual-regression",
    screens: [
      { name: "dashboard", navText: "Home" },
      { name: "setup", navText: "Setup" },
    ],
  },
};
```

## What each check does

### CSS Sync
Extracts CSS from three sources in the prototype and compares against your implementation CSS:
- **`<style>` block class selectors** — catches class name drift
- **Inline `style="..."` attributes** — extracts CSS custom properties (`--var: value`) and verifies they match `:root`
- **JS `THEME` objects** — extracts tokens from JavaScript theme objects and verifies day tokens match `:root`, night tokens match `[data-theme="night"]`

RGBA values are normalized (`0.86` == `.86`).

### Structural Verification
Checks that required CSS tokens exist in `:root`, that patterns exist in source files, and that component files contain required CSS classes.

### Skeleton Extraction
Extracts HTML sections from the prototype using regex patterns and generates a `component-skeletons.md` showing the exact markup your components must reproduce.

### Visual Regression
Captures screenshots of both prototype and implementation using Playwright, navigates through configured screens with multi-step sequences, and generates side-by-side comparisons.

Requires: `npx playwright install chromium`

## Multi-screen visual config

Define screens with step sequences in `design-contract.config.js`:

```js
screens: [
  // Single click navigation
  { name: "dashboard", navText: "Home" },

  // Multi-step navigation
  { name: "session", steps: [
    { click: "Setup" },
    { wait: 2000 },
    { clickExactButton: "Study" },  // exact role name match
    { click: "Start" },
    { wait: 3000 },
  ]},

  // With data injection and reload
  { name: "results", steps: [
    { custom: "seed-idb" },  // run project-defined seed script via customStepFiles
    { reload: true },     // reload page (both platforms)
    { click: "Progress" },
    { wait: 2000 },
  ]},

  // Fallback selectors (try each until one works)
  { name: "study-reveal", steps: [
    { waitFor: [".option-button", "button:has(span:text-is('A'))"] },
    { click: [".option-button", "button:has(span:text-is('A'))"] },
  ]},

  // Reload for clean state before capturing
  { name: "progress", reloadBeforeCapture: true, steps: [
    { click: "Progress" },
    { wait: 2000 },
  ]},
],
```

### Step types

| Step | Type | Description |
|---|---|---|
| `click` | `string \| string[]` | Click element by text, title, aria-label, or CSS selector. Array = try each until one works. |
| `clickExactButton` | `string` | Click button by exact role name. Handles whitespace normalization. |
| `waitFor` | `string \| string[]` | Wait for element to appear. Array = try each. |
| `waitForText` | `string` | Wait for text to appear on page. |
| `wait` | `number` | Wait N milliseconds. |
| `dismiss` | `string` | Dismiss a modal overlay by clicking a button with this text. |
| `seedIdb` | `boolean` | DEPRECATED — use `custom` step with `customStepFiles` instead. |
| `custom` | `string` | Run a project-defined step. Value matches a key in `visual.customStepFiles`. The referenced JS file is read and evaluated in browser context via `page.evaluate()`. Skipped silently on prototype side. |
| `reload` | `boolean` | Reload the page. Use after `custom` seed steps to pick up injected data. |

## Interpreting results

| Failure | Fix |
|---|---|
| Token value mismatch | Update CSS custom property to match prototype value exactly |
| `.class-name` not in CSS | Add the class to your CSS file, or add to `skipList` in config |
| Prototype section not found | Update the regex pattern in config `skeleton.sections` |
| Button click matches wrong element | Use `clickExactButton` for exact match, or array fallback selectors |
| Screenshots not captured | Run `npx playwright install chromium`, ensure dev server is running |
| `seedIdb` has no effect | `seedIdb` is deprecated. Use `custom` step with `customStepFiles` instead. |
| Button not visible after reload | Prototype runtime may need more time. Increase wait after reload step. |

## Comparisons

Side-by-side images are generated using Playwright (renders both screenshots in an HTML page and captures the result). No ImageMagick required.

## Prototype HTTP serving

Prototypes that load data via `<script src="...">` need HTTP serving (file:// blocks CORS). d2cc auto-starts `npx http-server` (fallback `python3 -m http.server`) on port 9876 to serve the prototype.

## CI integration

```yaml
# .github/workflows/contract-verify.yml
- run: npx playwright install --with-deps chromium
- run: npx d2cc verify
```

Exit code 0 = all checks pass. Exit code 1 = violations found.

For JSON output:
```yaml
- run: npx d2cc verify --json > contract-report.json
- if: failure()
  run: cat contract-report.json
```

## MCP Server

d2cc includes an MCP server with 5 tools (`d2cc_verify`, `d2cc_css_sync`, `d2cc_structural`, `d2cc_skeleton`, `d2cc_visual`).

MCP setup format varies by platform (OpenCode, Claude Code, Cursor, Claude Desktop). See the [MCP Server section of the README](https://github.com/mikejmckinney/d2cc#mcp-server) for platform-specific config examples.

> MCP servers are loaded at startup. After adding the config, restart your agent/IDE for the tools to appear. You do NOT need MCP to use d2cc — the CLI (`npx d2cc verify`) works independently.

## API usage

```ts
import { loadConfig, runCssSync, runVisual, buildReport, renderText } from "design-to-code-contract";

const { config } = await loadConfig(process.cwd());
const suites = [runCssSync(config, process.cwd()), await runVisual(config, process.cwd())];
const report = buildReport(suites);
console.log(renderText(report));
```
