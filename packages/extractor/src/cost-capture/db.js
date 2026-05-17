import Database from "better-sqlite3";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const DB_DIR = join(process.env.HOME, ".claude-timeline");
const DB_PATH = join(DB_DIR, "cost-stream.db");

export function getDb() {
  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  initSchema(db);
  return db;
}

function initSchema(db) {
  db.exec(`
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
      ON cost_snapshots(session_id);

    CREATE TABLE IF NOT EXISTS session_cost_summary (
      session_id              TEXT PRIMARY KEY,
      total_cost_usd          REAL,
      model                   TEXT,
      snapshot_count          INTEGER DEFAULT 0,
      first_snapshot_at       TEXT,
      last_snapshot_at        TEXT,
      updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function upsertSnapshot(db, data) {
  const stmt = db.prepare(`
    INSERT INTO cost_snapshots
      (session_id, total_cost_usd, duration_ms, api_duration_ms,
       input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
       model, lines_added, lines_removed, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    data.session_id,
    data.total_cost_usd ?? data.cost_usd ?? null,
    data.duration_ms ?? null,
    data.api_duration_ms ?? null,
    data.input_tokens ?? 0,
    data.output_tokens ?? 0,
    data.cache_read_tokens ?? 0,
    data.cache_creation_tokens ?? 0,
    data.model ?? null,
    data.lines_added ?? 0,
    data.lines_removed ?? 0,
    data.raw_json ?? null,
  );
}

export function upsertSessionSummary(db, data) {
  const stmt = db.prepare(`
    INSERT INTO session_cost_summary (session_id, total_cost_usd, model, snapshot_count, first_snapshot_at, last_snapshot_at, updated_at)
    VALUES (?, ?, ?, 1, datetime('now'), datetime('now'), datetime('now'))
    ON CONFLICT(session_id) DO UPDATE SET
      total_cost_usd = MAX(session_cost_summary.total_cost_usd, excluded.total_cost_usd),
      model = excluded.model,
      snapshot_count = session_cost_summary.snapshot_count + 1,
      last_snapshot_at = datetime('now'),
      updated_at = datetime('now')
  `);
  return stmt.run(data.session_id, data.total_cost_usd, data.model);
}

export function getSessionSummary(db, sessionId) {
  return db.prepare(
    "SELECT * FROM session_cost_summary WHERE session_id = ?"
  ).get(sessionId);
}

export function getLatestSnapshots(db, sessionId, limit = 5) {
  return db.prepare(
    "SELECT * FROM cost_snapshots WHERE session_id = ? ORDER BY id DESC LIMIT ?"
  ).all(sessionId, limit);
}
