import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

// Compile src/tui.tsx with the Solid transform the opencode TUI host expects.
// The output is committed to dist/ because GitHub installs run with
// ignoreScripts and get no build step. Host-provided modules stay external;
// the opencode TUI remaps them to its own instances at load time.
const result = await Bun.build({
  entrypoints: ["src/tui.tsx"],
  outdir: "dist",
  format: "esm",
  target: "bun",
  external: ["@opentui/core", "@opentui/solid", "solid-js", "@opencode-ai/plugin"],
  plugins: [createSolidTransformPlugin({ moduleName: "@opentui/solid" })],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log("built dist/tui.js")
