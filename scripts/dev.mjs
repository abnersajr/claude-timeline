#!/usr/bin/env node
/**
 * Dev script — starts the API server and web UI in parallel.
 *
 *   pnpm dev          → HTTP  (localhost:5199 → localhost:3099)
 *   pnpm dev --https  → HTTPS (via localias proxy, requires localias setup)
 */
import { spawn } from "node:child_process"

const useHttps = process.argv.includes("--https")

const apiEnv = { ...process.env }
const webEnv = {
  ...process.env,
  ...(useHttps ? {} : { VITE_API_URL: "http://localhost:3099" }),
}

console.log(
  useHttps
    ? "🔒 Dev mode: HTTPS (requires localias)"
    : "🔓 Dev mode: HTTP (no localias needed)",
)

const api = spawn("pnpm", ["--filter", "@claude-timeline/api", "dev"], {
  stdio: "inherit",
  env: apiEnv,
})

const web = spawn("pnpm", ["--filter", "claude-timeline-web", "dev"], {
  stdio: "inherit",
  env: webEnv,
})

function cleanup() {
  api.kill("SIGTERM")
  web.kill("SIGTERM")
  process.exit(0)
}

process.on("SIGINT", cleanup)
process.on("SIGTERM", cleanup)

api.on("close", cleanup)
web.on("close", cleanup)
