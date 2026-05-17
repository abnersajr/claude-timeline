import Database from "better-sqlite3"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

/**
 * Fixture seed script — creates a seeded SQLite DB + sample JSONL
 * for portable integration tests.
 *
 * Run with: pnpm fixtures:seed
 */

const FIXTURES_DIR = join(import.meta.dirname, "..")
const DB_PATH = join(FIXTURES_DIR, "fixtures", "test.db")
const JSONL_DIR = join(FIXTURES_DIR, "fixtures", "projects", "-Users-test-project")
const SESSION_ID = "test-session-001"
const PROJECT_NAME = "/Users/test-project"

function seedDatabase(): void {
  mkdirSync(dirname(DB_PATH), { recursive: true })
  mkdirSync(JSONL_DIR, { recursive: true })

  const db = new Database(DB_PATH)

  // Create tables matching the extractor schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL,
      turn_count INTEGER NOT NULL,
      total_input_tokens INTEGER NOT NULL DEFAULT 0,
      total_output_tokens INTEGER NOT NULL DEFAULT 0,
      total_cache_read INTEGER NOT NULL DEFAULT 0,
      total_cache_creation INTEGER NOT NULL DEFAULT 0,
      first_timestamp TEXT NOT NULL,
      last_timestamp TEXT NOT NULL,
      git_branch TEXT,
      model TEXT
    );

    CREATE TABLE IF NOT EXISTS turns (
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      tool_name TEXT,
      cwd TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      PRIMARY KEY (session_id, timestamp)
    );
  `)

  // Seed session
  db.prepare(
    `INSERT OR REPLACE INTO sessions
      (session_id, project_name, turn_count, total_input_tokens, total_output_tokens,
       total_cache_read, total_cache_creation, first_timestamp, last_timestamp, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    SESSION_ID,
    PROJECT_NAME,
    3,             // turn_count
    5000,          // total_input_tokens
    2000,          // total_output_tokens
    1000,          // total_cache_read
    500,           // total_cache_creation
    "2026-01-15T10:00:00.000Z",
    "2026-01-15T10:05:00.000Z",
    "claude-sonnet-4-20250514",
  )

  // Seed 3 turns
  const insertTurn = db.prepare(
    `INSERT OR REPLACE INTO turns
      (session_id, timestamp, tool_name, cwd, input_tokens, output_tokens,
       cache_read_tokens, cache_creation_tokens, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  insertTurn.run(SESSION_ID, "2026-01-15T10:00:00.000Z", null, "/Users/test-project", 2000, 800, 0, 500, "claude-sonnet-4-20250514")
  insertTurn.run(SESSION_ID, "2026-01-15T10:02:30.000Z", "Read", "/Users/test-project", 1500, 600, 500, 0, "claude-sonnet-4-20250514")
  insertTurn.run(SESSION_ID, "2026-01-15T10:05:00.000Z", "Write", "/Users/test-project", 1500, 600, 500, 0, "claude-sonnet-4-20250514")

  db.close()
  console.log(`Seeded database: ${DB_PATH}`)
}

function seedJsonl(): void {
  const jsonlPath = join(JSONL_DIR, `${SESSION_ID}.jsonl`)

  const records = [
    {
      type: "user",
      timestamp: "2026-01-15T10:00:00.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "Hello, help me with this code." }],
      },
    },
    {
      type: "assistant",
      timestamp: "2026-01-15T10:00:01.000Z",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [{ type: "text", text: "I'll help you with that." }],
        usage: {
          input_tokens: 2000,
          output_tokens: 800,
          cache_read_input_tokens: 0,
          cache_creation: {
            ephemeral_5m_input_tokens: 500,
            ephemeral_1h_input_tokens: 0,
          },
        },
      },
    },
    {
      type: "user",
      timestamp: "2026-01-15T10:02:30.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "Now read the file." }],
      },
    },
    {
      type: "assistant",
      timestamp: "2026-01-15T10:02:31.000Z",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [
          { type: "tool_use", id: "tu_001", name: "Read", input: { file_path: "/test.ts" } },
        ],
        usage: {
          input_tokens: 1500,
          output_tokens: 600,
          cache_read_input_tokens: 500,
        },
      },
    },
    {
      type: "tool_result",
      timestamp: "2026-01-15T10:02:32.000Z",
      toolUseResult: {
        toolUseId: "tu_001",
        content: "file contents here",
        isError: false,
      },
    },
    {
      type: "user",
      timestamp: "2026-01-15T10:05:00.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "Now write the fix." }],
      },
    },
    {
      type: "assistant",
      timestamp: "2026-01-15T10:05:01.000Z",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [
          { type: "tool_use", id: "tu_002", name: "Write", input: { file_path: "/test.ts", content: "fixed" } },
        ],
        usage: {
          input_tokens: 1500,
          output_tokens: 600,
          cache_read_input_tokens: 500,
        },
      },
    },
  ]

  const lines = records.map((r) => JSON.stringify(r)).join("\n")
  writeFileSync(jsonlPath, lines + "\n", "utf-8")
  console.log(`Seeded JSONL: ${jsonlPath}`)
}

seedDatabase()
seedJsonl()
console.log("Fixtures seeded successfully.")
