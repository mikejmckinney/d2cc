// design-to-code-contract — core barrel export
// SPDX-License-Identifier: MIT

export type {
  ContractConfig,
  ContractReport,
  SuiteResult,
  CheckResult,
} from "./types.js";
export { DEFAULT_CONFIG } from "./types.js";
export { loadConfig, generateDefaultConfig } from "./config.js";
export {
  renderText,
  renderJSON,
  buildReport,
  check,
  suite,
} from "./reporter.js";
