import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
  DbOpenError,
  getModelForSession,
  getSession,
  getTurns,
  listSessions,
  SessionNotFoundError,
} from "../src/db-reader.js"

let dbPath: string

beforeEach(() => {
  const dir = join(tmpdir(), `db-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  dbPath = join(dir, "test.db")

  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      project_name TEXT,
      turn_count INTEGER,
      total_input_tokens INTEGER,
      total_output_tokens INTEGER,
      total_cache_read INTEGER,
      total_cache_creation INTEGER,
      first_timestamp TEXT,
      last_timestamp TEXT,
      git_branch TEXT,
      model TEXT
    )
  `)
  db.exec(`
    CREATE TABLE turns (
      session_id TEXT,
      timestamp TEXT,
      tool_name TEXT,
      cwd TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_creation_tokens INTEGER,
      model TEXT
    )
  `)
  db.exec(`
    INSERT INTO sessions VALUES (
      'test-session-1', 'test-project', 2, 30, 14550, 929057, 34383,
      '2026-05-07T19:22:45.000Z', '2026-05-07T19:50:00.000Z', 'main', 'claude-sonnet-4-6'
    )
  `)
  db.exec(`
    INSERT INTO turns VALUES (
      'test-session-1', '2026-05-07T19:22:45.118Z', 'Bash', '/Users/test',
      2, 323, 12143, 12973, 'claude-sonnet-4-6'
    )
  `)
  db.exec(`
    INSERT INTO turns VALUES (
      'test-session-1', '2026-05-07T19:22:52.379Z', 'Bash', '/Users/test',
      1, 222, 25116, 410, 'claude-sonnet-4-6'
    )
  `)
  db.close()
})

afterEach(() => {
  try {
    rmSync(dbPath, { force: true })
    rmSync(join(dbPath, ".."), { recursive: true, force: true })
  } catch {}
})

describe("getSession", () => {
  test("returns correct SessionMetadata", () => {
    const session = getSession(dbPath, "test-session-1")
    expect(session.sessionId).toBe("test-session-1")
    expect(session.projectName).toBe("test-project")
    expect(session.model).toBe("claude-sonnet-4-6")
    expect(session.turnCount).toBe(2)
    expect(session.totalTokens.inputTokens).toBe(30)
    expect(session.totalTokens.outputTokens).toBe(14550)
    expect(session.totalTokens.cacheReadTokens).toBe(929057)
    expect(session.totalTokens.cacheCreation5mTokens).toBe(34383)
  })

  test("throws SessionNotFoundError for missing ID", () => {
    expect(() => getSession(dbPath, "nonexistent")).toThrow(SessionNotFoundError)
  })

  test("throws DbOpenError for invalid path", () => {
    expect(() => getSession("/nonexistent/path/db.sqlite", "test")).toThrow(DbOpenError)
  })
})

describe("getTurns", () => {
  test("returns array of Turn objects", () => {
    const turns = getTurns(dbPath, "test-session-1")
    expect(turns).toHaveLength(2)
    expect(turns[0].timestamp).toBe("2026-05-07T19:22:45.118Z")
    expect(turns[0].tokenUsage.inputTokens).toBe(2)
    expect(turns[0].tokenUsage.outputTokens).toBe(323)
    expect(turns[0].toolName).toBe("Bash")
    expect(turns[0].cwd).toBe("/Users/test")
  })

  test("returns empty array for session with no turns", () => {
    const db = new Database(dbPath)
    db.exec(`
      INSERT INTO sessions VALUES (
        'empty-session', 'test-project', 0, 0, 0, 0, 0,
        '2026-05-07T19:50:00.000Z', '2026-05-07T19:50:00.000Z', 'main', 'claude-sonnet-4-6'
      )
    `)
    db.close()
    const turns = getTurns(dbPath, "empty-session")
    expect(turns).toHaveLength(0)
  })
})

describe("getModelForSession", () => {
  test("returns model from first turn", () => {
    const model = getModelForSession(dbPath, "test-session-1")
    expect(model).toBe("claude-sonnet-4-6")
  })

  test("returns fallback for session with no turns", () => {
    const db = new Database(dbPath)
    db.exec(`
      INSERT INTO sessions VALUES (
        'no-turns-session', 'test-project', 0, 0, 0, 0, 0,
        '2026-05-07T19:50:00.000Z', '2026-05-07T19:50:00.000Z', 'main', 'claude-sonnet-4-6'
      )
    `)
    db.close()
    const model = getModelForSession(dbPath, "no-turns-session")
    expect(model).toBe("claude-sonnet-4-6")
  })
})

describe("listSessions", () => {
  test("returns sessions ordered by last_timestamp desc", () => {
    const db = new Database(dbPath)
    db.exec(`
      INSERT INTO sessions VALUES (
        'session-2', 'test-project', 1, 10, 500, 1000, 500,
        '2026-05-08T09:00:00.000Z', '2026-05-08T10:00:00.000Z', 'main', 'claude-sonnet-4-6'
      )
    `)
    db.close()

    const sessions = listSessions(dbPath)
    expect(sessions.length).toBeGreaterThanOrEqual(2)
    expect(sessions[0].sessionId).toBe("session-2")
    expect(sessions[0].lastTimestamp).toBe("2026-05-08T10:00:00.000Z")
  })

  test("returns empty array when no sessions exist", () => {
    const dir = join(tmpdir(), `empty-db-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const emptyDbPath = join(dir, "empty.db")
    const db = new Database(emptyDbPath)
    db.exec(`CREATE TABLE sessions (session_id TEXT PRIMARY KEY, project_name TEXT, turn_count INTEGER, total_input_tokens INTEGER, total_output_tokens INTEGER, total_cache_read INTEGER, total_cache_creation INTEGER, first_timestamp TEXT, last_timestamp TEXT, git_branch TEXT, model TEXT)`)
    db.close()

    const sessions = listSessions(emptyDbPath)
    expect(sessions).toEqual([])

    rmSync(dir, { recursive: true, force: true })
  })
})
