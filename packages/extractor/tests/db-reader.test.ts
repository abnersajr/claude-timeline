import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
  DbOpenError,
  getModelForSession,
  getProcessedFiles,
  getSession,
  getTurns,
  listJsonlSessions,
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

describe("getProcessedFiles", () => {
  test("returns processed file entries", () => {
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE IF NOT EXISTS processed_files (
        path TEXT PRIMARY KEY,
        mtime REAL,
        lines INTEGER
      )
    `)
    db.exec(`
      INSERT INTO processed_files VALUES (
        '/Users/test/.claude/projects/-Users-test/abc-12345678-1234-1234-1234-123456789012.jsonl',
        1778182387.61482,
        135
      )
    `)
    db.close()

    const files = getProcessedFiles(dbPath)
    expect(files.length).toBe(1)
    expect(files[0].path).toContain("abc-12345678-1234-1234-1234-123456789012.jsonl")
    expect(files[0].lines).toBe(135)
    expect(files[0].sessionId).toBe("abc-12345678-1234-1234-1234-123456789012")
  })

  test("returns empty array when table is empty", () => {
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE IF NOT EXISTS processed_files (
        path TEXT PRIMARY KEY,
        mtime REAL,
        lines INTEGER
      )
    `)
    db.close()

    const files = getProcessedFiles(dbPath)
    expect(files).toEqual([])
  })

  test("returns empty array when table does not exist", () => {
    const files = getProcessedFiles(dbPath)
    expect(files).toEqual([])
  })
})

describe("listJsonlSessions (JSONL-only sessions)", () => {
  let projectsDir: string
  let emptyDbPath: string

  beforeEach(() => {
    const dir = join(tmpdir(), `jsonl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    emptyDbPath = join(dir, "empty.db")
    projectsDir = join(dir, "projects")
    mkdirSync(projectsDir, { recursive: true })

    // Create empty SQLite DB with required tables
    const db = new Database(emptyDbPath)
    db.exec(`CREATE TABLE sessions (session_id TEXT PRIMARY KEY)`)
    db.exec(`CREATE TABLE processed_files (path TEXT PRIMARY KEY, mtime REAL, lines INTEGER)`)
    db.close()
  })

  afterEach(() => {
    try {
      rmSync(join(projectsDir, ".."), { recursive: true, force: true })
    } catch {}
  })

  test("detects string content in user messages (Bug 1)", () => {
    const sessionId = "test-jsonl-string-content-001"
    const projectDir = join(projectsDir, "test-project")
    mkdirSync(projectDir, { recursive: true })

    const jsonlLines = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-05-10T10:00:00.000Z",
        message: { role: "user", content: "Hello, can you help me?" },
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-05-10T10:00:05.000Z",
        message: { role: "user", content: "Follow-up question" },
      }),
    ]
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), jsonlLines.join("\n"))

    const results = listJsonlSessions(projectsDir, emptyDbPath)
    expect(results).toHaveLength(1)
    const summary = results[0]

    // Bug 1 fix: lastTimestamp should be from the file, not new Date()
    expect(summary.lastTimestamp).toBe("2026-05-10T10:00:05.000Z")
    expect(summary.turnCount).toBe(2) // two user messages
  })

  test("does not inflate activeDuration from non-contentful records (Bug 2)", () => {
    const sessionId = "test-jsonl-no-inflate-002"
    const projectDir = join(projectsDir, "test-project")
    mkdirSync(projectDir, { recursive: true })

    const jsonlLines = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-05-10T10:00:00.000Z",
        message: { role: "user", content: "Only one real message" },
      }),
    ]
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), jsonlLines.join("\n"))

    const results = listJsonlSessions(projectsDir, emptyDbPath)
    expect(results).toHaveLength(1)
    const summary = results[0]

    // With only one timestamp, active duration should be 0
    expect(summary.activeDurationMs).toBe(0)
  })

  test("falls back to last file timestamp, not new Date() (Bug 3)", () => {
    const sessionId = "test-jsonl-fallback-003"
    const projectDir = join(projectsDir, "test-project")
    mkdirSync(projectDir, { recursive: true })

    const beforeMs = Date.now()
    const jsonlLines = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-05-10T12:30:00.000Z",
        message: { role: "user", content: "A message" },
      }),
    ]
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), jsonlLines.join("\n"))

    const results = listJsonlSessions(projectsDir, emptyDbPath)
    const afterMs = Date.now()
    expect(results).toHaveLength(1)
    const summary = results[0]

    // Should use file timestamp, not current time
    expect(summary.lastTimestamp).toBe("2026-05-10T12:30:00.000Z")
    const resultTime = new Date(summary.lastTimestamp).getTime()
    expect(resultTime).toBeLessThanOrEqual(beforeMs)
  })
})
