# d2cc — Design-to-Code Contract Enforcement

Prototypes are the source of truth. This tool verifies your React/Vue/Svelte implementation matches them.

## Install

```bash
npm install -D design-to-code-contract
```

## Quick start

```bash
# Generate a config file in your project root
npx d2cc init

# Run all checks
npx d2cc verify

# Run individual checks
npx d2cc css-sync
npx d2cc structural
npx d2cc skeleton
npx d2cc visual
```

## Configuration

Create `design-contract.config.js` in your project root (or run `d2cc init`):

```js
export default {
  prototype: "prototype.html",           // source of truth
  implementation: {
    src: "src",                          // component source directory
    css: "src/app.css",                  // implementation CSS file
  },
  cssSync: {
    enabled: true,
    skipList: [],                        // prototype-only classes to skip
  },
  structural: {
    enabled: true,
    components: {                        // file → required CSS classes
      "Dashboard.tsx": ["hero", "card"],
    },
    requiredTokens: ["--bg", "--fg"],    // CSS tokens that must be defined
    svgPaths: { "Icon Name": "M12 2..." },
    patterns: {                          // arbitrary string checks
      "dark-mode": { file: "src/app.css", pattern: '[data-theme="dark"]' },
    },
  },
  skeleton: {
    enabled: true,
    output: "component-skeletons.md",
    sections: [
      { name: "Header", pattern: '(<header class="header".*?</header>)' },
    ],
  },
  visual: {
    enabled: true,
    serverUrl: "http://localhost:5173",
    viewports: [
      { name: "desktop", width: 940, height: 800 },
      { name: "mobile", width: 390, height: 844 },
    ],
    outputDir: "visual-regression",
    skipClasses: [],
  },
};
```

## Four checks

### 1. CSS Sync (`d2cc css-sync`)
Extracts CSS class selectors from the prototype's `<style>` blocks and verifies each exists in your implementation CSS. Catches CSS drift — when the prototype uses `.hero-card` but your code uses `.heroCard`.

### 2. Structural Verification (`d2cc structural`)
Checks that specific files contain required CSS classes, that CSS tokens are defined in `:root`, that SVG paths match, and that naming conventions are followed. Configurable per-project.

### 3. Skeleton Extraction (`d2cc skeleton`)
Extracts the HTML structure from prototype sections and generates a `component-skeletons.md` showing the exact markup your React components must reproduce.

### 4. Visual Regression (`d2cc visual`)
Captures screenshots of both the prototype and your running dev server using Playwright, creates side-by-side comparisons, and diffs CSS class names between prototype and source. Requires `npx playwright install chromium`.

## CI integration

```yaml
# .github/workflows/contract.yml
- run: npx d2cc verify --json > contract-report.json
- if: failure()
  run: cat contract-report.json
```

Exit code 0 = all checks pass. Exit code 1 = violations found.

## API usage

```ts
import { loadConfig, runCssSync, runStructural, buildReport, renderText } from "design-to-code-contract";

const { config } = await loadConfig(process.cwd());
const suites = [runCssSync(config, process.cwd()), runStructural(config, process.cwd())];
const report = buildReport(suites);
console.log(renderText(report));
```

## How it works

The prototype HTML file is the single source of truth. d2cc extracts CSS classes, markup structure, and visual patterns from it, then verifies your implementation code matches. No intermediate manifest to maintain — the enforcement scripts read directly from the prototype.

## Why d2cc?

Existing design QA tools solve adjacent problems, but none enforce **prototype-to-implementation fidelity** — the gap where "the agent built something that doesn't look like the mockup."

| Tool | What it checks | Prototype enforcement? | Complementary to d2cc? |
|---|---|---|---|
| **deslint** | Design token compliance (colors, spacing, radius) | No — lints code against your token system, not against a prototype | Yes — use alongside for token hygiene |
| **Playwright `toHaveScreenshot()`** | Pixel diff against prior screenshots | No — compares current vs previous build, not current vs prototype | Yes — d2cc can wrap it for prototype-vs-impl screenshots |
| **BackstopJS** | Pixel diff via Resemble.js with HTML reports | No — same as Playwright, previous-vs-current | Yes — better reporting UX |
| **Chromatic / Percy** | Cloud visual regression on Storybook stories | No — compares renders across branches, not code against a prototype | Yes — for Storybook-first teams |
| **Storybook Visual Tests** | Pixel diff per story | No — treats stories as the spec | Yes — component-level complement |
| **@axe-core/playwright** | WCAG accessibility violations | No — accessibility only | Yes — adds the a11y enforcement axis |
| **Code Connect (Figma)** | Code snippets in Figma Dev Mode | One-way — suggests code from design, doesn't verify code matches | Yes — solves the inverse direction |
| **Fidel** | Deployed page vs Figma spec (0-100 score) | Closest — but operates on deployed pages, not CI/code | Adjacent — cloud service, not CI-native |
| **compare-html** | Structured HTML diff with path tracking | Yes — structural diff primitive | Library — d2cc could depend on it |

**d2cc's unique value:** extracts CSS classes, markup structure, and patterns directly from the prototype HTML and verifies the implementation matches. No intermediate manifest, no manual reference screenshots, no cloud service. Runs in CI with exit code 0/1.

**d2cc does not replace** Playwright, deslint, axe-core, or Chromatic. It fills the one gap they all share: nobody checks that the code matches the prototype.

## MCP Server

d2cc includes an MCP server for agent integration. Agents can invoke verification during implementation, catching drift before it compounds.

```json
{
  "mcpServers": {
    "d2cc": {
      "command": "npx",
      "args": ["d2cc", "mcp"]
    }
  }
}
```

Available tools:
- `d2cc_verify` — run all checks, returns structured results
- `d2cc_css_sync` — check CSS class sync only
- `d2cc_structural` — check structural verification only
- `d2cc_skeleton` — extract component skeletons from prototype

## License

MIT
