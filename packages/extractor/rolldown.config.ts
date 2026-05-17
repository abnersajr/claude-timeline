import { defineConfig } from "rolldown"
import { builtinModules } from "node:module"

export default defineConfig({
  input: "src/cli.ts",
  output: {
    file: "dist/cli.js",
    format: "es",
    codeSplitting: false,
  },
  external: [
    "better-sqlite3",
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
})
