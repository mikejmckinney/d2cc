#!/usr/bin/env node
// d2cc — design-to-code contract enforcement CLI
// SPDX-License-Identifier: MIT

import("../dist/cli/index.js").catch((err) => {
  console.error("Failed to load d2cc CLI:", err.message);
  console.error("Did you run `npm run build`?");
  process.exit(1);
});
