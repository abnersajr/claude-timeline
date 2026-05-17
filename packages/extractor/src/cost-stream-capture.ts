/**
 * Stdin JSON parser and batch capture for Claude Code cost data.
 *
 * Usage:
 *   - Real-time: pipe Claude Code's stdin to this module
 *   - Batch: cost-stream-capture.ts --batch <file>
 */

import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import { CostStreamDb, getCostStreamDbPath } from "./cost-stream-db.js"

// ─── Capture Types ───────────────────────────────────────────────────

export interface StdinCostData {
  sessionId: string
  timestamp: string
  totalCostUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  model: string | null
  durationMs: number | null
  apiDurationMs: number | null
  linesAdded: number
  linesRemoved: number
  rawJson?: string
}

// ─── Stdin JSON Parsing ──────────────────────────────────────────────

/**
 * Parse a single stdin JSON line into StdinCostData.
 * Returns null if the line doesn't contain cost data.
 */
export function parseStdinCostJson(line: string, sessionId?: string): StdinCostData | null {
  try {
    const parsed = JSON.parse(line)

    // Extract session ID from the JSON or fallback to parameter
    const sid = sessionId ?? parsed.session_id ?? parsed.sessionId
    if (!sid) return null

    // Extract timestamp
    const timestamp = parsed.timestamp ?? parsed.ts ?? new Date().toISOString()

    // Extract cost data — handle multiple possible shapes
    const cost = parsed.cost ?? parsed.usage?.cost ?? {}
    const totalCostUsd = cost.total_cost_usd ?? cost.totalCostUsd ?? 0

    // Extract token data
    const usage = parsed.usage ?? {}
    const inputTokens = usage.input_tokens ?? usage.inputTokens ?? 0
    const outputTokens = usage.output_tokens ?? usage.outputTokens ?? 0
    const cacheReadTokens = usage.cache_read_tokens ?? usage.cacheReadTokens ?? 0
    const cacheCreationTokens = usage.cache_creation_tokens ?? usage.cacheCreationTokens ?? 0

    // Extract model
    const model = parsed.model ?? usage.model ?? null

    // Extract durations
    const durationMs = parsed.duration_ms ?? parsed.durationMs ?? null
    const apiDurationMs = parsed.api_duration_ms ?? parsed.apiDurationMs ?? null

    // Extract line counts
    const linesAdded = parsed.lines_added ?? parsed.linesAdded ?? 0
    const linesRemoved = parsed.lines_removed ?? parsed.linesRemoved ?? 0

    // Skip if no meaningful data
    if (totalCostUsd === 0 && inputTokens === 0 && outputTokens === 0) {
      return null
    }

    return {
      sessionId: sid,
      timestamp,
      totalCostUsd,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      model,
      durationMs,
      apiDurationMs,
      linesAdded,
      linesRemoved,
      rawJson: line,
    }
  } catch {
    return null
  }
}

// ─── Real-time Capture ───────────────────────────────────────────────

/**
 * Start capturing cost data from stdin in real-time.
 * Writes to cost-stream.db as data arrives.
 *
 * Returns a cleanup function to stop capture.
 */
export function startStdinCapture(
  dbPath?: string,
  sessionId?: string,
): { stop: () => void; db: CostStreamDb } {
  const resolvedDbPath = getCostStreamDbPath(dbPath)
  const db = new CostStreamDb(resolvedDbPath)

  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  })

  let running = true

  rl.on("line", (line) => {
    if (!running) return
    const trimmed = line.trim()
    if (!trimmed) return

    const data = parseStdinCostJson(trimmed, sessionId)
    if (data) {
      try {
        db.insertSnapshot(data)
      } catch (err) {
        console.error(`Failed to insert cost snapshot: ${err}`)
      }
    }
  })

  rl.on("close", () => {
    running = false
  })

  return {
    stop: () => {
      running = false
      rl.close()
      db.close()
    },
    db,
  }
}

// ─── Batch Capture ───────────────────────────────────────────────────

/**
 * Process a saved stdin log file in batch mode.
 * Each line is expected to be a JSON object with cost data.
 */
export async function batchCapture(
  filePath: string,
  dbPath?: string,
): Promise<{ processed: number; skipped: number }> {
  const resolvedDbPath = getCostStreamDbPath(dbPath)
  const db = new CostStreamDb(resolvedDbPath)

  let processed = 0
  let skipped = 0

  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    })

    rl.on("line", (line) => {
      const trimmed = line.trim()
      if (!trimmed) return

      const data = parseStdinCostJson(trimmed)
      if (data) {
        try {
          db.insertSnapshot(data)
          processed++
        } catch (err) {
          console.error(`Failed to insert cost snapshot: ${err}`)
          skipped++
        }
      } else {
        skipped++
      }
    })

    rl.on("close", () => {
      db.close()
      resolve({ processed, skipped })
    })

    rl.on("error", (err) => {
      db.close()
      reject(err)
    })
  })
}

// ─── CLI Entry Point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args[0] === "--batch" && args[1]) {
    const filePath = args[1]
    const dbPath = args[2]
    console.log(`Processing batch file: ${filePath}`)
    const result = await batchCapture(filePath, dbPath)
    console.log(`Done. Processed: ${result.processed}, Skipped: ${result.skipped}`)
    return
  }

  // Default: real-time capture from stdin
  console.log("Listening for cost data on stdin... (Ctrl+C to stop)")
  const { stop } = startStdinCapture(args[0])

  process.on("SIGINT", () => {
    console.log("\nStopping capture...")
    stop()
    process.exit(0)
  })
}

// Run on direct execution only
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("cost-stream-capture.ts")

if (isMainModule) {
  main().catch((err) => {
    console.error(String(err))
    process.exit(1)
  })
}
