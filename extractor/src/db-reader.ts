import Database from "better-sqlite3"
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
  last_timestamp: string
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

    const model = getModelForSession(dbPath, sessionId)

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
      workingDirectory: "",
      turnCount: row.turn_count,
      totalTokens,
      startTime: "",
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
      cacheWriteType: "none" as const,
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
