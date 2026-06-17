import Database from "better-sqlite3"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { classifyMessage } from "./classifier.js"
import { deduplicateByRequestId } from "./dedup.js"
import { calculateSessionCost } from "./pricing.js"
import { listSubagentFiles } from "./subagent-locator.js"
import { resolveSubagents } from "./subagent-resolver.js"
import type { SessionMetadata, TokenUsage, Turn } from "./types.js"

/**
 * Compute active duration by summing gaps between consecutive timestamps
 * that are below a threshold (5 minutes). Large gaps represent idle/closed
 * sessions and are excluded.
 */
function computeActiveDurationMs(
  timestamps: string[],
  thresholdMs = 5 * 60 * 1000,
): number {
  if (timestamps.length < 2) return 0
  let activeMs = 0
  for (let i = 1; i < timestamps.length; i++) {
    const gap = new Date(timestamps[i]).getTime() - new Date(timestamps[i - 1]).getTime()
    if (gap > 0 && gap < thresholdMs) {
      activeMs += gap
    }
  }
  return activeMs
}

/** Error when SQLite DB cannot be opened */
export class DbOpenError extends Error {
  code = 3
  constructor(message: string) {
    super(message)
    this.name = "DbOpenError"
  }
}

/** Error when session_id not found in DB */
export class SessionNotFoundError extends Error {
  code = 2
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`)
    this.name = "SessionNotFoundError"
  }
}

interface SessionRow {
  session_id: string
  project_name: string
  turn_count: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_read: number
  total_cache_creation: number
  first_timestamp: string
  last_timestamp: string
  git_branch: string | null
  model: string | null
}

interface TurnRow {
  session_id: string
  timestamp: string
  tool_name: string | null
  cwd: string | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  model: string | null
}

/**
 * Get session metadata from SQLite DB
 * Returns null when DB doesn't exist or can't be opened (instead of throwing).
 */
export function getSession(dbPath: string, sessionId: string): SessionMetadata | null {
  if (!existsSync(dbPath)) return null
  let db: Database.Database
  try {
    db = new Database(dbPath, { readonly: true })
  } catch {
    return null
  }

  try {
    const row = db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId) as
      | SessionRow
      | undefined

    if (!row) {
      throw new SessionNotFoundError(sessionId)
    }

    const rawModel = row.model || getModelForSession(dbPath, sessionId)
    const model = rawModel === "unknown" ? "claude-sonnet-4-6" : rawModel

    // Infer working directory from most common cwd in turns
    const cwdRow = db
      .prepare(
        "SELECT cwd, COUNT(*) as cnt FROM turns WHERE session_id = ? AND cwd IS NOT NULL GROUP BY cwd ORDER BY cnt DESC LIMIT 1",
      )
      .get(sessionId) as { cwd: string } | undefined

    const totalTokens: TokenUsage = {
      inputTokens: row.total_input_tokens,
      outputTokens: row.total_output_tokens,
      cacheReadTokens: row.total_cache_read,
      cacheCreation5mTokens: row.total_cache_creation,
      cacheCreation1hTokens: 0,
    }

    return {
      sessionId: row.session_id,
      projectName: row.project_name,
      model,
      workingDirectory: cwdRow?.cwd ?? "",
      turnCount: row.turn_count,
      totalTokens,
      startTime: row.first_timestamp,
      endTime: row.last_timestamp,
      isOngoing: false,
    }
  } finally {
    db.close()
  }
}

/**
 * Get all turns for a session from SQLite DB
 */
export function getTurns(dbPath: string, sessionId: string): Turn[] {
  if (!existsSync(dbPath)) return []
  let db: Database.Database
  try {
    db = new Database(dbPath, { readonly: true })
  } catch {
    return []
  }

  try {
    const rows = db
      .prepare("SELECT * FROM turns WHERE session_id = ? ORDER BY timestamp ASC")
      .all(sessionId) as TurnRow[]

    return rows.map((row) => ({
      timestamp: row.timestamp,
      tokenUsage: {
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cacheReadTokens: row.cache_read_tokens,
        cacheCreation5mTokens: row.cache_creation_tokens,
        cacheCreation1hTokens: 0,
      },
      toolName: row.tool_name ?? undefined,
      cwd: row.cwd ?? undefined,
      messages: [],
      toolCalls: [],
      cacheWriteType: (row.cache_creation_tokens > 0 ? "5m" : "none") as "5m" | "1h" | "none",
      cacheReadType: "unknown" as const,
      cacheCreationTokensThisTurn: row.cache_creation_tokens,
    }))
  } finally {
    db.close()
  }
}

/**
 * Get the model for a session (from first turn)
 * Falls back to 'claude-sonnet-4-6' if not found
 */
export function getModelForSession(dbPath: string, sessionId: string): string {
  if (!existsSync(dbPath)) return "claude-sonnet-4-6"
  let db: Database.Database
  try {
    db = new Database(dbPath, { readonly: true })
  } catch {
    return "claude-sonnet-4-6"
  }

  try {
    const row = db
      .prepare("SELECT model FROM turns WHERE session_id = ? ORDER BY timestamp ASC LIMIT 1")
      .get(sessionId) as { model: string | null } | undefined

    return row?.model ?? "claude-sonnet-4-6"
  } finally {
    db.close()
  }
}

/** Processed file entry */
export interface ProcessedFile {
  path: string
  mtime: number
  lines: number
  sessionId: string | null
}

/**
 * Extract session ID from JSONL file path.
 * e.g., '/.../abc-123.jsonl' -> 'abc-123'
 */
function extractSessionIdFromPath(filePath: string): string | null {
  const match = filePath.match(/([^/]+)\.jsonl$/)
  return match ? match[1] : null
}

/**
 * Get processed files from the DB.
 * Returns empty array if table doesn't exist or DB can't be opened.
 */
export function getProcessedFiles(dbPath: string): ProcessedFile[] {
  if (!existsSync(dbPath)) return []
  let db: Database.Database
  try {
    db = new Database(dbPath, { readonly: true })
  } catch {
    // DB doesn't exist or can't be opened — return empty array instead of throwing
    return []
  }

  try {
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='processed_files'")
      .get()

    if (!tableExists) return []

    const rows = db.prepare("SELECT * FROM processed_files").all() as Array<{
      path: string
      mtime: number
      lines: number
    }>

    return rows.map((row) => ({
      path: row.path,
      mtime: row.mtime,
      lines: row.lines,
      sessionId: extractSessionIdFromPath(row.path),
    }))
  } finally {
    db.close()
  }
}

/** Session summary for listing */
export interface SessionSummary {
  sessionId: string
  projectName: string
  model: string
  turnCount: number
  lastTimestamp: string
  totalCostEstimate: number
  hasThinking: boolean
  activeDurationMs?: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheWriteType: "5m" | "1h" | "none"
}

/**
 * List all sessions from the DB, ordered by most recent first.
 * Returns empty array if DB doesn't exist or can't be opened.
 */
export function listSessions(dbPath: string, limit = 20): SessionSummary[] {
  if (!existsSync(dbPath)) return []
  let db: Database.Database
  try {
    db = new Database(dbPath, { readonly: true })
  } catch {
    // DB doesn't exist or can't be opened — return empty array instead of throwing
    return []
  }

  try {
    const rows = db
      .prepare(
        `SELECT session_id, project_name, model, turn_count, first_timestamp, last_timestamp,
                total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation
         FROM sessions ORDER BY last_timestamp DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      session_id: string
      project_name: string
      model: string | null
      turn_count: number
      first_timestamp: string
      last_timestamp: string
      total_input_tokens: number
      total_output_tokens: number
      total_cache_read: number
      total_cache_creation: number
    }>

    return rows.map((row) => {
      const model = (row.model && row.model !== "unknown") ? row.model : "claude-sonnet-4-6"
      // Build a minimal SessionMetadata + Turn[] to use the canonical cost calculator
      const session: SessionMetadata = {
        sessionId: row.session_id,
        projectName: row.project_name,
        model,
        workingDirectory: "",
        turnCount: row.turn_count,
        totalTokens: {
          inputTokens: row.total_input_tokens,
          outputTokens: row.total_output_tokens,
          cacheReadTokens: row.total_cache_read,
          cacheCreation5mTokens: row.total_cache_creation,
          cacheCreation1hTokens: 0,
        },
        startTime: row.first_timestamp,
        endTime: row.last_timestamp,
        isOngoing: false,
      }
      // Use one synthetic turn with totals so calculateSessionCost applies correct rates
      const syntheticTurns: Turn[] = [
        {
          timestamp: row.last_timestamp,
          tokenUsage: session.totalTokens,
          messages: [],
          toolCalls: [],
          cacheWriteType: (row.total_cache_creation > 0 ? "5m" : "none") as "5m" | "none",
          cacheReadType: "unknown" as const,
          cacheCreationTokensThisTurn: row.total_cache_creation,
        },
      ]
      const pricing = calculateSessionCost(session, syntheticTurns)

      const cacheWriteType = row.total_cache_creation > 0 ? "5m" : "none"

      return {
        sessionId: row.session_id,
        projectName: row.project_name,
        model,
        turnCount: row.turn_count,
        lastTimestamp: row.last_timestamp,
        totalCostEstimate: pricing.totalCost,
        hasThinking: false,
        cacheReadTokens: row.total_cache_read,
        cacheWriteTokens: row.total_cache_creation,
        cacheWriteType,
      }
    })
  } finally {
    db.close()
  }
}

/**
 * Get the set of session IDs that exist in the SQLite DB.
 */
function getExistingSessionIds(dbPath: string): Set<string> {
  try {
    const db = new Database(dbPath, { readonly: true })
    try {
      const rows = db.prepare("SELECT session_id FROM sessions").all() as Array<{
        session_id: string
      }>
      return new Set(rows.map((r) => r.session_id))
    } finally {
      db.close()
    }
  } catch {
    return new Set()
  }
}

/**
 * Parse a JSONL file header to extract session summary metadata.
 * Reads the file incrementally — stops after finding enough data.
 */
function parseJsonlSummary(
  filePath: string,
  sessionId: string,
  projectName: string,
): SessionSummary | null {
  try {
    const content = readFileSync(filePath, "utf-8")
    const lines = content.split("\n").filter((l) => l.trim().length > 0)
    if (lines.length === 0) return null

    // Parse all records, filter noise, deduplicate — same pipeline as parseSessionJsonl
    const allRecords: Record<string, unknown>[] = []
    for (const line of lines) {
      try {
        allRecords.push(JSON.parse(line))
      } catch {
        continue
      }
    }

    const nonNoise = allRecords.filter(
      (r) => classifyMessage(r as unknown as import("./types.js").RawJsonlRecord) !== "hardNoise",
    )
    const records = deduplicateByRequestId(
      nonNoise as unknown as import("./types.js").RawJsonlRecord[],
    )

    let model = "claude-sonnet-4-6"
    let turnCount = 0
    let lastTimestamp = ""
    let totalInput = 0
    let totalOutput = 0
    let totalCacheRead = 0
    let totalCacheCreation5m = 0
    let totalCacheCreation1h = 0
    let hasThinking = false
    let lastFileTimestamp = ""
    const allTimestamps: string[] = []

    for (const record of records) {
      const category = classifyMessage(record)

      const msg = record.message as Record<string, unknown> | undefined

      // Track timestamps — only from records with actual content
      const ts = record.timestamp
      if (ts) lastFileTimestamp = ts
      const hasContent = (totalInput + totalOutput + totalCacheRead + totalCacheCreation5m + totalCacheCreation1h > 0) ||
        (msg?.usage as Record<string, unknown> | undefined != null) ||
        (typeof msg?.content === "string" && (msg.content as string).length > 0) ||
        (Array.isArray((msg?.content as unknown[]) ?? []) && ((msg?.content as unknown[]) ?? []).length > 0)
      if (ts && hasContent) {
        lastTimestamp = ts
        allTimestamps.push(ts)
      }

      // Extract model from assistant messages
      if (record.type === "assistant" && msg?.model) {
        model = msg.model as string
      }

      // Count turns: assistant + real user messages (matches buildTurnsFromJsonl)
      if (category === "assistant" || category === "user") {
        turnCount++
      }

      // Accumulate token usage from any message with usage data
      const usage = msg?.usage as Record<string, unknown> | undefined
      if (usage) {
        totalInput += (usage.input_tokens as number) ?? 0
        totalOutput += (usage.output_tokens as number) ?? 0
        totalCacheRead += (usage.cache_read_input_tokens as number) ?? 0
        const cc = usage.cache_creation as Record<string, number> | undefined
        totalCacheCreation5m +=
          (usage.cacheCreation5mTokens as number) ?? cc?.ephemeral_5m_input_tokens ?? 0
        totalCacheCreation1h +=
          (usage.cacheCreation1hTokens as number) ?? cc?.ephemeral_1h_input_tokens ?? 0
      }

      // Detect thinking blocks in assistant content (empty but present = thinking was used)
      if (!hasThinking && record.type === "assistant" && Array.isArray(msg?.content)) {
        hasThinking = (msg.content as Array<Record<string, unknown>>).some(
          (b) => b.type === "thinking",
        )
      }
    }

    // Use canonical cost calculator
    const session: SessionMetadata = {
      sessionId,
      projectName,
      model,
      workingDirectory: "",
      turnCount,
      totalTokens: {
        inputTokens: totalInput,
        outputTokens: totalOutput,
        cacheReadTokens: totalCacheRead,
        cacheCreation5mTokens: totalCacheCreation5m,
        cacheCreation1hTokens: totalCacheCreation1h,
      },
      startTime: "",
      endTime: lastTimestamp || lastFileTimestamp || new Date().toISOString(),
      isOngoing: false,
    }
    const syntheticTurns: Turn[] =
      totalInput > 0 || totalOutput > 0
        ? [
            {
              timestamp: lastTimestamp || lastFileTimestamp || new Date().toISOString(),
              tokenUsage: session.totalTokens,
              messages: [],
              toolCalls: [],
              cacheWriteType: (totalCacheCreation5m > 0
                ? "5m"
                : totalCacheCreation1h > 0
                  ? "1h"
                  : "none") as "5m" | "1h" | "none",
              cacheReadType: "unknown" as const,
              cacheCreationTokensThisTurn: totalCacheCreation5m + totalCacheCreation1h,
            },
          ]
        : []
    const pricing = calculateSessionCost(session, syntheticTurns)

    // Include agent costs from agent-*.jsonl files
    let agentCost = 0
    try {
      const agentFiles = listSubagentFiles(
        join(dirname(filePath), ".."),  // projectsDir is parent of project dir
        projectName,
        sessionId,
      )
      if (agentFiles.length > 0) {
        const subagents = resolveSubagents(agentFiles, [])
        agentCost = subagents.reduce((sum, s) => sum + (s.totalCost ?? 0), 0)
      }
    } catch {
      // Agent resolution is best-effort for summary
    }

    const totalCacheWrite = totalCacheCreation5m + totalCacheCreation1h
    const cacheWriteType: "5m" | "1h" | "none" =
      totalCacheCreation5m > 0 ? "5m" : totalCacheCreation1h > 0 ? "1h" : "none"

    return {
      sessionId,
      projectName,
      model,
      turnCount,
      lastTimestamp: lastTimestamp || lastFileTimestamp || new Date().toISOString(),
      totalCostEstimate: pricing.totalCost + agentCost,
      hasThinking,
      activeDurationMs: computeActiveDurationMs(allTimestamps),
      cacheReadTokens: totalCacheRead,
      cacheWriteTokens: totalCacheWrite,
      cacheWriteType,
    }
  } catch {
    return null
  }
}

/**
 * List sessions discovered from JSONL files on disk.
 * Skips sessions that already exist in the SQLite DB.
 * Skips subagent files (agent-*.jsonl).
 */
export function listJsonlSessions(
  projectsDir: string,
  dbPath: string,
  limit = 100,
): SessionSummary[] {
  const existingIds = getExistingSessionIds(dbPath)
  const results: SessionSummary[] = []

  if (!existsSync(projectsDir)) return results

  try {
    const projectDirs = readdirSync(projectsDir)

    for (const dirName of projectDirs) {
      const projectDir = join(projectsDir, dirName)
      // Skip if not a directory
      try {
        const s = statSync(projectDir)
        if (!s.isDirectory()) continue
      } catch {
        continue
      }

      // Strip leading '-' (from leading '/' in original path)
      // Use raw directory name — decodeProjectName is lossy for paths with hyphens
      const projectName = dirName.startsWith("-") ? dirName.slice(1) : dirName

      // Find .jsonl files (skip agent-*.jsonl subagent files)
      try {
        const files = readdirSync(projectDir)
        for (const file of files) {
          if (!file.endsWith(".jsonl")) continue
          if (file.startsWith("agent-")) continue

          const sessionId = file.replace(".jsonl", "")

          // Skip if already in SQLite
          if (existingIds.has(sessionId)) continue

          const filePath = join(projectDir, file)
          const summary = parseJsonlSummary(filePath, sessionId, projectName)
          if (summary) results.push(summary)
        }
      } catch {
        // Skip unreadable directories
      }
    }
  } catch {
    // Skip if projects dir doesn't exist
  }

  // Sort by most recent first, apply limit
  results.sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp))
  return results.slice(0, limit)
}
