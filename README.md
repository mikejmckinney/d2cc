# d2cc — Design-to-Code Contract Enforcement

Prototypes are the source of truth. d2cc verifies your React/Vue/Svelte implementation matches them.

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
    devCommand: "npm run dev",           // d2cc auto-starts the server if not running
    serverTimeout: 30000,                // ms to wait for server readiness
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
Extracts CSS styles from the prototype via three sources and verifies each matches in your implementation CSS:

- **`<style>` block class selectors** — catches CSS class drift (prototype uses `.hero-card`, your code uses `.heroCard`)
- **Inline `style="..."` attributes** — extracts CSS custom properties (`--var: value`) from inline styles and verifies they match `:root` in your CSS
- **JS `THEME` objects** — extracts tokens from JavaScript theme objects (e.g., `const THEME = { day: {...}, night: {...} }`) and verifies day tokens match `:root` and night tokens match `[data-theme="night"]`

All three sources run automatically in a single `css-sync` check. RGBA values are normalized for comparison (`rgba(255,253,249,.86)` == `rgba(255, 253, 249, 0.86)`).

### 2. Structural Verification (`d2cc structural`)
Checks that specific files contain required CSS classes, that CSS tokens are defined in `:root`, that SVG paths match, and that naming conventions are followed. Configurable per-project.

### 3. Skeleton Extraction (`d2cc skeleton`)
Extracts the HTML structure from prototype sections and generates a `component-skeletons.md` showing the exact markup your React components must reproduce.

### 4. Visual Regression (`d2cc visual`)
Captures screenshots of both the prototype and your running dev server using Playwright's programmatic API, navigates through multiple screens, creates side-by-side comparisons, and diffs CSS class names between prototype and source. Requires `npx playwright install chromium`.

**Multi-screen navigation:** Define screens in config with step sequences that click, wait, seed data, reload, and navigate through your app. Each screen captures a separate screenshot for both prototype and implementation.

```js
visual: {
  screens: [
    { name: "dashboard", navText: "Home" },                    // single click
    { name: "setup", navText: "Setup" },
    { name: "session", steps: [                                // multi-step
      { click: "Home" },
      { wait: 1000 },
      { click: "Setup" },
      { wait: 2000 },
      { clickExactButton: "Study" },                           // exact role match
      { wait: 1500 },
      { click: "Start study" },
      { wait: 3000 },
    ]},
    { name: "results", steps: [
      { custom: "seed-idb" },                                  // run project-defined seed script
      { reload: true },                                        // reload page (both platforms)
      { click: "Progress" },
      { wait: 2000 },
    ]},
    { name: "session-study-reveal", steps: [
      { waitFor: [".option-button", "button:has(span:text-is('A'))"] },  // fallback selectors
      { click: [".option-button", "button:has(span:text-is('A'))"] },
    ]},
  ],
}
```

**Step types:**
| Step | Type | Description |
|---|---|---|
| `click` | `string \| string[]` | Click element by text/title/aria-label/CSS selector. Array = try each until one works. |
| `clickExactButton` | `string` | Click button by exact role name (`getByRole('button', {name, exact: true})`). Handles whitespace normalization. |
| `waitFor` | `string \| string[]` | Wait for element to appear. Array = try each. |
| `waitForText` | `string` | Wait for text to appear on page. |
| `wait` | `number` | Wait N milliseconds. |
| `dismiss` | `string` | Dismiss a modal overlay by clicking a button with this text. |
| `custom` | `string` | Run a project-defined step. Value matches a key in `visual.customStepFiles`. The referenced JS file is read and evaluated in browser context via `page.evaluate()`. Skipped silently on prototype side. |
| `reload` | `boolean` | Reload the page (both platforms). Use after `custom` seed steps to pick up injected data. |

**Comparisons:** Side-by-side images are generated using Playwright (renders both screenshots in an HTML page and captures the result). No ImageMagick required.

**Prototype HTTP serving:** Prototypes that load data via `<script src="...">` need HTTP serving (file:// blocks CORS). d2cc auto-starts `npx http-server` (fallback `python3 -m http.server`) on port 9876 to serve the prototype.

**Auto-start**: If `devCommand` is set in config and the server isn't running, d2cc starts it automatically, waits for readiness, captures screenshots, then shuts it down. No manual server management needed.

## CI integration

```yaml
# .github/workflows/contract-verify.yml
name: Contract Verification
on:
  push:
    branches: [main, develop, "redesign/**"]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run contract:verify
```

Exit code 0 = all checks pass. Exit code 1 = violations found.

For JSON output in CI:

```yaml
- run: npx d2cc verify --json > contract-report.json
- if: failure()
  run: cat contract-report.json
```

## API usage

```ts
import { loadConfig, runCssSync, runStructural, buildReport, renderText } from "design-to-code-contract";

const { config } = await loadConfig(process.cwd());
const suites = [runCssSync(config, process.cwd()), runStructural(config, process.cwd())];
const report = buildReport(suites);
console.log(renderText(report));
```

Individual check modules are also importable:

```ts
import { runCssSync } from "design-to-code-contract/css-sync";
import { runStructural } from "design-to-code-contract/structural";
import { runSkeleton } from "design-to-code-contract/skeleton";
import { runVisual } from "design-to-code-contract/visual";
```

## How it works

The prototype HTML file is the single source of truth. d2cc extracts CSS classes, markup structure, and visual patterns from it, then verifies your implementation code matches. No intermediate manifest to maintain — the enforcement scripts read directly from the prototype.

## MCP Server

d2cc includes an MCP server for agent integration. Agents can invoke verification during implementation, catching drift before it compounds.

Available tools:
- `d2cc_verify` — run all checks (CSS sync + structural + skeleton + visual)
- `d2cc_css_sync` — CSS custom property and class sync
- `d2cc_structural` — required tokens and patterns
- `d2cc_skeleton` — extract component skeletons from prototype
- `d2cc_visual` — multi-screen Playwright screenshots and comparisons

### MCP setup by platform

**OpenCode** — add to `opencode.json`:
```json
{
  "mcp": {
    "d2cc": {
      "type": "local",
      "command": ["npx", "d2cc", "mcp"],
      "enabled": true
    }
  }
}
```

**Claude Code** — add to `.mcp.json` in your project root:
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

**Cursor** — add to `.cursor/mcp.json`:
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

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):
```json
{
  "mcpServers": {
    "d2cc": {
      "command": "npx",
      "args": ["d2cc", "mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

> **Note:** MCP servers are loaded at startup. After adding the config, restart your agent/IDE for the `d2cc_*` tools to appear.

## Agent Skills

d2cc ships with a generic agent skill at `skills/d2cc/SKILL.md`. This gives AI coding agents (OpenCode, Claude Code, Cursor, etc.) workflow guidance for running, interpreting, and fixing d2cc findings.

**To use with OpenCode:**

Copy the skill into your project:
```bash
mkdir -p .opencode/skills/d2cc
cp node_modules/design-to-code-contract/skills/d2cc/SKILL.md .opencode/skills/d2cc/
```

**To use with Claude Code:**
```bash
mkdir -p .claude/skills/d2cc
cp node_modules/design-to-code-contract/skills/d2cc/SKILL.md .claude/skills/d2cc/
```

**To use with Cursor / other agents:**
```bash
mkdir -p .agents/skills/d2cc
cp node_modules/design-to-code-contract/skills/d2cc/SKILL.md .agents/skills/d2cc/
```

The skill teaches agents:
- When to run d2cc (after UI/CSS changes, before PRs)
- How to interpret each check's results
- How to fix common failures
- Multi-screen visual config with step types
- CI integration patterns

**Customize the skill** after copying — add project-specific context (your prototype path, dev server command, skip lists) to the bottom of the file.

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

## Architecture decisions

### Why monolithic, not modular?

d2cc was evaluated against two packaging strategies:

**Option A — Modular packages per subsystem:**
```
@scope/core          # shared types, config schema, contract model
@scope/css-sync      # CSS class extraction + token matching
@scope/structural    # HTML/DOM structural diff
@scope/skeleton      # skeleton/placeholder enforcement
@scope/visual        # visual regression orchestration
@scope/cli           # thin wrapper composing the above
```

**Option B — Monolithic package with internal modules:**
```
design-to-code-contract/
├── src/core/        # types, config, reporter
├── src/checks/      # css-sync, structural, skeleton, visual
├── src/mcp/         # MCP server
└── src/cli/         # CLI entry point
```

**We chose Option B (monolithic).** Here's why:

| Factor | Modular (A) | Monolithic (B) |
|---|---|---|
| **Setup overhead** | 6 packages, 6 `package.json`s, 6 publish configs, workspace orchestration | 1 package, 1 publish, 1 config |
| **Independent versioning** | Each check can version separately | All checks share one version |
| **Tree-shaking** | Consumers import only what they need | Same — ESM `exports` map provides sub-path imports (`d2cc/css-sync`) |
| **Independent consumption** | Can use `@scope/css-sync` without the CLI | Sub-path exports achieve the same: `import { runCssSync } from "design-to-code-contract/css-sync"` |
| **Team ownership** | Clear boundaries for multi-team contribution | Single codebase, single PR flow |
| **Cross-check dependencies** | Need to publish `@scope/core` before others can depend on it | Direct relative imports |
| **Release coordination** | 6 independent release pipelines, version compatibility matrix | 1 pipeline, atomic releases |

**The decisive factor:** at the current scale (1 project, 1 contributor, 4 checks), the overhead of 6 packages vastly outweighs the benefits. The sub-path exports pattern (`"exports"` field in `package.json`) gives consumers the same import ergonomics as modular packages without the coordination cost:

```ts
// These all work from a single installed package:
import { loadConfig } from "design-to-code-contract";        // core
import { runCssSync } from "design-to-code-contract/css-sync";
import { runStructural } from "design-to-code-contract/structural";
import { runSkeleton } from "design-to-code-contract/skeleton";
import { runVisual } from "design-to-code-contract/visual";
```

### When to split into modular packages

If d2cc grows beyond 3 active projects or multiple contributors, the modular approach becomes worth the overhead. The trigger points:

| Signal | Action |
|---|---|
| 3+ projects actively using d2cc | Split `css-sync` and `structural` into separate packages — they have no shared deps beyond `core` |
| Different teams own different checks | Split each check into its own package with `@scope/core` as a shared dependency |
| Checks need different release cadences | Modular packages with independent semver |
| External contributors want to add checks | Plugin architecture (see below) |

### Future architecture: plugin system

The long-term shape if d2cc grows:

```
design-to-code-contract/          # core + CLI (thin)
├── src/core/                     # types, config, reporter, plugin API
├── src/cli/                      # CLI entry point
├── src/mcp/                      # MCP server
└── plugins/
    ├── css-sync/                 # built-in plugin
    ├── structural/               # built-in plugin
    ├── skeleton/                 # built-in plugin
    └── visual/                   # built-in plugin

# Third-party plugins:
@scope/d2cc-a11y                  # accessibility check
@scope/d2cc-tokens                # design token extraction
@scope/d2cc-figma                 # Figma API integration
```

The plugin API would expose:

```ts
interface D2ccPlugin {
  name: string;
  check(config: ContractConfig, projectRoot: string): Promise<SuiteResult>;
}
```

Config would accept plugins:

```js
export default {
  plugins: [
    "@scope/d2cc-a11y",
    ["@scope/d2cc-figma", { figmaToken: "..." }],
  ],
};
```

This preserves the monolithic core while allowing community extensions. The plugin interface is simple enough that splitting built-in checks into separate packages later is a mechanical refactor, not a redesign.

## License

MIT
