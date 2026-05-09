import Database from "better-sqlite3"
import { getPricing } from "./pricing.js"
import type { SessionMetadata, TokenUsage, Turn } from "./types.js"

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
 */
export function getSession(dbPath: string, sessionId: string): SessionMetadata {
  let db: Database.Database
  try {
    db = new Database(dbPath, { readonly: true })
  } catch (_err) {
    throw new DbOpenError(`Failed to open database: ${dbPath}`)
  }

  try {
    const row = db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId) as
      | SessionRow
      | undefined

    if (!row) {
      throw new SessionNotFoundError(sessionId)
    }

    const model = row.model || getModelForSession(dbPath, sessionId)

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
    }
  } finally {
    db.close()
  }
}

/**
 * Get all turns for a session from SQLite DB
 */
export function getTurns(dbPath: string, sessionId: string): Turn[] {
  let db: Database.Database
  try {
    db = new Database(dbPath, { readonly: true })
  } catch (_err) {
    throw new DbOpenError(`Failed to open database: ${dbPath}`)
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
  let db: Database.Database
  try {
    db = new Database(dbPath, { readonly: true })
  } catch (_err) {
    throw new DbOpenError(`Failed to open database: ${dbPath}`)
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

/** Session summary for listing */
export interface SessionSummary {
  sessionId: string
  projectName: string
  model: string
  turnCount: number
  lastTimestamp: string
  totalCostEstimate: number
}

/**
 * List all sessions from the DB, ordered by most recent first.
 */
export function listSessions(dbPath: string, limit = 20): SessionSummary[] {
  let db: Database.Database
  try {
    db = new Database(dbPath, { readonly: true })
  } catch (_err) {
    throw new DbOpenError(`Failed to open database: ${dbPath}`)
  }

  try {
    const rows = db
      .prepare(
        `SELECT session_id, project_name, model, turn_count, last_timestamp,
                total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation
         FROM sessions ORDER BY last_timestamp DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      session_id: string
      project_name: string
      model: string | null
      turn_count: number
      last_timestamp: string
      total_input_tokens: number
      total_output_tokens: number
      total_cache_read: number
      total_cache_creation: number
    }>

    return rows.map((row) => {
      const model = row.model || "claude-sonnet-4-6"
      const rate = getPricing(model)
      const cost =
        (row.total_input_tokens / 1_000_000) * rate.inputPerMTok +
        (row.total_output_tokens / 1_000_000) * rate.outputPerMTok +
        (row.total_cache_read / 1_000_000) * rate.cacheReadPerMTok +
        (row.total_cache_creation / 1_000_000) * rate.cacheCreation5mPerMTok

      return {
        sessionId: row.session_id,
        projectName: row.project_name,
        model,
        turnCount: row.turn_count,
        lastTimestamp: row.last_timestamp,
        totalCostEstimate: cost,
      }
    })
  } finally {
    db.close()
  }
}
