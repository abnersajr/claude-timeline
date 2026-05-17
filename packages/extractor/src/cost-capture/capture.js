#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { getDb, upsertSnapshot, upsertSessionSummary } from "./db.js";

const CONFIG_PATH = join(process.env.HOME, ".claude-timeline", "config.json");

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function parseStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve(null);

    let raw = "";
    let settled = false;
    let firstByteTimer;
    let idleTimer;

    const cleanup = () => {
      clearTimeout(firstByteTimer);
      clearTimeout(idleTimer);
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.pause();
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const tryParse = () => {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      try { return JSON.parse(trimmed); } catch { return undefined; }
    };

    const onData = (chunk) => {
      clearTimeout(firstByteTimer);
      raw += String(chunk);
      const parsed = tryParse();
      if (parsed !== undefined) return finish(parsed);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(tryParse() ?? null), 30);
    };

    const onEnd = () => finish(tryParse() ?? null);

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    firstByteTimer = setTimeout(() => finish(null), 250);
  });
}

function extractCostData(json) {
  const cost = json.cost ?? {};
  const ctx = json.context_window ?? {};
  const current = ctx.current_usage ?? {};

  return {
    session_id: json.session_id ?? null,
    total_cost_usd: typeof cost.total_cost_usd === "number" ? cost.total_cost_usd : null,
    duration_ms: cost.total_duration_ms ?? null,
    api_duration_ms: cost.total_api_duration_ms ?? null,
    input_tokens: ctx.total_input_tokens ?? current.input_tokens ?? 0,
    output_tokens: ctx.total_output_tokens ?? current.output_tokens ?? 0,
    cache_read_tokens: current.cache_read_input_tokens ?? 0,
    cache_creation_tokens: current.cache_creation_input_tokens ?? 0,
    model: json.model?.display_name ?? json.model?.id ?? null,
    lines_added: cost.total_lines_added ?? 0,
    lines_removed: cost.total_lines_removed ?? 0,
  };
}

function killOtherInstances() {
  try {
    const myPid = process.pid;
    const pids = execSync("pgrep -f 'node.*capture\\.js'", { encoding: "utf-8" })
      .trim().split("\n").filter(Boolean).map(Number).filter((p) => p !== myPid);
    for (const pid of pids) {
      try { process.kill(pid, "SIGTERM"); } catch {}
    }
  } catch {}
}

async function main() {
  killOtherInstances();
  const data = await parseStdin();
  if (!data?.session_id) {
    process.exit(0);
  }

  const costData = extractCostData(data);

  try {
    const db = getDb();
    upsertSnapshot(db, { ...costData, raw_json: JSON.stringify(data) });
    if (costData.total_cost_usd !== null) {
      upsertSessionSummary(db, {
        session_id: costData.session_id,
        total_cost_usd: costData.total_cost_usd,
        model: costData.model,
      });
    }
    db.close();
  } catch (e) {
    process.stderr.write(`[cost-capture] DB error: ${e.message}\n`);
  }

  const config = loadConfig();
  if (config.originalStatusLine?.command) {
    try {
      const { spawnSync } = await import("node:child_process");
      const result = spawnSync("sh", ["-c", config.originalStatusLine.command], {
        input: JSON.stringify(data),
        encoding: "utf-8",
        timeout: 2000,
        env: { ...process.env, COLUMNS: process.env.COLUMNS ?? "80" },
      });
      if (result.stdout) process.stdout.write(result.stdout);
    } catch {
      // Original statusline failed — not our problem
    }
  }

  process.exit(0);
}

main();
