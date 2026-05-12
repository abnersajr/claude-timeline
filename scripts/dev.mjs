#!/usr/bin/env node
/**
 * Dev script — starts the monorepo in HTTP or HTTPS mode.
 *
 *   pnpm dev          → HTTP  (localhost:5199 → localhost:3099, no localias needed)
 *   pnpm dev --https  → HTTPS (via localias proxy, requires localias setup)
 */
import { execFileSync } from "node:child_process";

const useHttps = process.argv.includes("--https");

const env = {
  ...process.env,
  // In HTTP mode, point the web app at the bare API port.
  // In HTTPS mode, leave VITE_API_URL unset so the web app
  // uses its built-in default (https://api.claude-dash.local).
  ...(useHttps ? {} : { VITE_API_URL: "http://localhost:3099" }),
};

console.log(
  useHttps
    ? "🔒 Dev mode: HTTPS (requires localias)"
    : "🔓 Dev mode: HTTP (no localias needed)",
);

// turbo is on PATH via pnpm's node_modules/.bin
execFileSync("turbo", ["dev"], {
  stdio: "inherit",
  env,
});
