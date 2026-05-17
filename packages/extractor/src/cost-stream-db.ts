/**
 * SQLite CRUD layer for cost-stream.db
 *
 * Stores ground-truth cost data from Claude Code's stdin stream.
 * This is separate from usage.db (which is read-only and owned by Claude Code).
 */

import Database from "better-sqlite3"
import { existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

// ─── Schema ──────────────────────────────────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS cost_snapshots (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id               TEXT NOT NULL,
    timestamp                TEXT NOT NULL DEFAULT (datetime('now')),
    total_cost_usd           REAL,
    input_tokens             INTEGER DEFAULT 0,
    output_tokens            INTEGER DEFAULT 0,
    cache_read_tokens        INTEGER DEFAULT 0,
    cache_creation_tokens    INTEGER DEFAULT 0,
    model                    TEXT,
    duration_ms              INTEGER,
    api_duration_ms          INTEGER,
    lines_added              INTEGER DEFAULT 0,
    lines_removed            INTEGER DEFAULT 0,
    raw_json                 TEXT,
    created_at               TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_cost_snapshots_session
    ON cost_snapshots(session_id, timestamp);

  CREATE TABLE IF NOT EXISTS session_cost_summary (
    session_id              TEXT PRIMARY KEY,
    total_cost_usd          REAL,
    model                   TEXT,
    snapshot_count          INTEGER DEFAULT 0,
    first_snapshot_at       TEXT,
    last_snapshot_at        TEXT,
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
  );
`

// ─── Types ───────────────────────────────────────────────────────────

export interface CostSnapshotRow {
  id: number
  session_id: string
  timestamp: string
  total_cost_usd: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  model: string | null
  duration_ms: number | null
  api_duration_ms: number | null
  lines_added: number
  lines_removed: number
  raw_json: string | null
  created_at: string
}

export interface SessionCostSummaryRow {
  session_id: string
  total_cost_usd: number
  model: string | null
  snapshot_count: number
  first_snapshot_at: string | null
  last_snapshot_at: string | null
  updated_at: string
}

// ─── Database Class ──────────────────────────────────────────────────

export class CostStreamDb {
  private db: Database.Database

  constructor(dbPath: string) {
    // Ensure parent directory exists
    const dir = dirname(dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    this.db = new Database(dbPath)
    this.db.pragma("journal_mode = WAL")
    this.db.pragma("foreign_keys = ON")
    this.db.exec(SCHEMA_SQL)
  }

  /**
   * Insert a cost snapshot from stdin data.
   * Returns the snapshot ID.
   */
  insertSnapshot(data: {
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
  }): number {
    const insertSnapshot = this.db.prepare(`
      INSERT INTO cost_snapshots
        (session_id, timestamp, total_cost_usd, input_tokens, output_tokens,
         cache_read_tokens, cache_creation_tokens, model, duration_ms,
         api_duration_ms, lines_added, lines_removed, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const upsertSummary = this.db.prepare(`
      INSERT INTO session_cost_summary
        (session_id, total_cost_usd, model,
         snapshot_count, first_snapshot_at, last_snapshot_at)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        total_cost_usd = excluded.total_cost_usd,
        model = excluded.model,
        snapshot_count = snapshot_count + 1,
        last_snapshot_at = excluded.last_snapshot_at,
        updated_at = datetime('now')
    `)

    const transaction = this.db.transaction(() => {
      const result = insertSnapshot.run(
        data.sessionId,
        data.timestamp,
        data.totalCostUsd,
        data.inputTokens,
        data.outputTokens,
        data.cacheReadTokens,
        data.cacheCreationTokens,
        data.model ?? null,
        data.durationMs ?? null,
        data.apiDurationMs ?? null,
        data.linesAdded,
        data.linesRemoved,
        data.rawJson ?? null,
      )
      const snapshotId = result.lastInsertRowid as number

      // Upsert session summary
      upsertSummary.run(
        data.sessionId,
        data.totalCostUsd,
        data.model ?? null,
        data.timestamp,
        data.timestamp,
      )

      return snapshotId
    })

    return transaction()
  }

  /**
   * Get the latest cost summary for a session.
   */
  getCostSummary(sessionId: string): SessionCostSummaryRow | undefined {
    return this.db
      .prepare("SELECT * FROM session_cost_summary WHERE session_id = ?")
      .get(sessionId) as SessionCostSummaryRow | undefined
  }

  /**
   * Get the latest cost snapshot for a session.
   */
  getLatestSnapshot(sessionId: string): CostSnapshotRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM cost_snapshots WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1",
      )
      .get(sessionId) as CostSnapshotRow | undefined
  }

  /**
   * Get all cost snapshots for a session (for time-series).
   */
  getSnapshots(sessionId: string, limit = 1000): CostSnapshotRow[] {
    return this.db
      .prepare(
        "SELECT * FROM cost_snapshots WHERE session_id = ? ORDER BY timestamp ASC LIMIT ?",
      )
      .all(sessionId, limit) as CostSnapshotRow[]
  }

  /**
   * Check if a session has cost-stream data.
   */
  hasCostData(sessionId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM session_cost_summary WHERE session_id = ?")
      .get(sessionId)
    return row !== undefined
  }

  /**
   * Get cost summaries for multiple sessions in one query.
   * Returns a Map of sessionId → total_cost_usd.
   */
  getCostSummariesForSessions(
    sessionIds: string[],
  ): Map<string, number> {
    if (sessionIds.length === 0) return new Map()
    const placeholders = sessionIds.map(() => "?").join(",")
    const rows = this.db
      .prepare(
        `SELECT session_id, total_cost_usd
         FROM session_cost_summary
         WHERE session_id IN (${placeholders})`,
      )
      .all(...sessionIds) as Array<{
      session_id: string
      total_cost_usd: number
    }>
    const map = new Map<string, number>()
    for (const r of rows) {
      map.set(r.session_id, r.total_cost_usd)
    }
    return map
  }

  /**
   * Get all session IDs with cost data.
   */
  getSessionIds(): string[] {
    const rows = this.db
      .prepare("SELECT session_id FROM session_cost_summary")
      .all() as Array<{ session_id: string }>
    return rows.map((r) => r.session_id)
  }

  close(): void {
    this.db.close()
  }
}

// ─── Default Path ────────────────────────────────────────────────────

import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Get the default path for cost-stream.db
 * Priority: customPath > ~/.claude-timeline/cost-stream.db
 */
export function getCostStreamDbPath(customPath?: string): string {
  if (customPath) return customPath
  return join(homedir(), ".claude-timeline", "cost-stream.db")
}
