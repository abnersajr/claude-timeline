#!/usr/bin/env node
"use strict";

// CLI entry point for claude-timeline
// Imports the main entry which re-exports parseArgs + outputJSON.
// The actual CLI logic is in the extractor's index.ts main().

import { parseArgs, outputJSON } from "../dist/index.js";
import * as fs from "node:fs";
import * as path from "node:path";

async function main() {
  const config = parseArgs(process.argv);

  if (config.listSessions) {
    const { listSessions, listJsonlSessions } = await import("../dist/db-reader.js");
    const dbSessions = listSessions(config.dbPath);
    const jsonlSessions = listJsonlSessions(config.projectsDir, config.dbPath);
    const seen = new Set(dbSessions.map((s) => s.sessionId));
    const merged = [...dbSessions];
    for (const s of jsonlSessions) {
      if (!seen.has(s.sessionId)) {
        merged.push(s);
        seen.add(s.sessionId);
      }
    }
    merged.sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp));
    outputJSON(merged, config.outputPath);
    return;
  }

  const sessionId = config.sessionId;

  // Dynamic imports to avoid loading everything upfront
  const { extractFullTimeline, extractJsonlTimeline } = await import("../dist/merger.js");

  // Try SQLite + JSONL merge first, fall back to JSONL-only
  let data;
  try {
    data = await extractFullTimeline(sessionId, config.dbPath, config.projectsDir);
  } catch (err) {
    if (err?.code === 2) {
      let foundPath = null;
      for (const dir of fs.readdirSync(config.projectsDir)) {
        const candidate = path.join(config.projectsDir, dir, `${sessionId}.jsonl`);
        if (fs.existsSync(candidate)) {
          foundPath = candidate;
          break;
        }
      }
      if (foundPath) {
        data = await extractJsonlTimeline(sessionId, config.projectsDir, foundPath);
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }

  outputJSON(data, config.outputPath);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
