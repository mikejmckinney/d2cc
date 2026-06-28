// design-to-code-contract — core types
// SPDX-License-Identifier: MIT
/** Default configuration template */
export const DEFAULT_CONFIG = {
    prototype: "prototype.html",
    implementation: {
        src: "src",
        css: "src/app.css",
    },
    cssSync: { enabled: true, skipList: [] },
    structural: { enabled: true },
    skeleton: { enabled: true, output: "component-skeletons.md" },
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
//# sourceMappingURL=types.js.map