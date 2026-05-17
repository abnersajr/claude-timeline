import { defineConfig } from "rolldown"
import { builtinModules } from "node:module"

export default defineConfig({
  input: "src/serve.ts",
  output: {
    file: "../extractor/dist/server.cjs",
    format: "cjs",
    codeSplitting: false,
  },
  external: [
    "better-sqlite3",
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
})
