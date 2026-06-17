# Own Usage DB — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace dependency on Claude Code's `~/.claude/usage.db` with our own indexed DB at `~/.claude-timeline/usage.db`, populated by scanning JSONL files.

**Architecture:** New `scanner.ts` module parses JSONL files and writes to our DB. `db-reader.ts` reads from our DB only. `merger.ts` simplified to use our DB as primary source. JSONL remains source of truth; our DB is a performance index.

**Tech Stack:** TypeScript, better-sqlite3, existing JSONL parsing logic

**Spec:** `docs/2026-06-17-own-usage-db-design.md`

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `packages/extractor/src/scanner.ts` | Create | JSONL scanner, writes to our usage.db |
| `packages/extractor/src/scanner.test.ts` | Create | Unit tests for scanner |
| `packages/extractor/src/db-reader.ts` | Modify | Remove listJsonlSessions, update getDbPath |
| `packages/extractor/src/utils.ts` | Modify | Change getDbPath to ~/.claude-timeline/usage.db |
| `packages/extractor/src/merger.ts` | Modify | Remove extractJsonlTimeline, simplify extractFullTimeline |
| `packages/extractor/src/cli.ts` | Modify | Add scan command, simplify list/extract |
| `packages/extractor/src/index.ts` | Modify | Export scanner, update parseArgs |
| `packages/api/src/serve.ts` | Modify | Add startup scan, remove old DB references |
| `packages/api/src/config.ts` | Modify | Replace dbPath with usageDbPath |
| `packages/extractor/tests/db-reader.test.ts` | Modify | Update tests for new DB path |

---

## Chunk 1: Scanner Module

### Task 1: Create scanner.ts with schema initialization

**Files:**
- Create: `packages/extractor/src/scanner.ts`

- [ ] **Step 1: Create scanner.ts with DB schema and initialization**

```typescript
/**
 * scanner.ts — Parses JSONL transcript files and stores data in SQLite.
 *
 * Our own usage.db at ~/.claude-timeline/usage.db.
 * Replaces dependency on Claude Code's ~/<claude>/usage.db.
 */

import Database from "better-sqlite3"
import { existsSync, readdirSync, statSync } from "node:fs"
import { glob } from "node:fs/promises"
import { homedir } from "node:os"
import { join, basename } from "node:path"
import { classifyMessage } from "./classifier.js"
import { deduplicateByRequestId } from "./dedup.js"
import type { RawJsonlRecord } from "./types.js"

// ─── Schema ──────────────────────────────────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS sessions (
    session_id              TEXT PRIMARY KEY,
    project_name            TEXT,
    model                   TEXT,
    turn_count              INTEGER DEFAULT 0,
    total_input_tokens      INTEGER DEFAULT 0,
    total_output_tokens     INTEGER DEFAULT 0,
    total_cache_read        INTEGER DEFAULT 0,
    total_cache_creation    INTEGER DEFAULT 0,
    first_timestamp         TEXT,
    last_timestamp          TEXT,
    git_branch              TEXT
  );

  CREATE TABLE IF NOT EXISTS turns (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id              TEXT NOT NULL,
    timestamp               TEXT,
    model                   TEXT,
    input_tokens            INTEGER DEFAULT 0,
    output_tokens           INTEGER DEFAULT 0,
    cache_read_tokens       INTEGER DEFAULT 0,
    cache_creation_tokens   INTEGER DEFAULT 0,
    tool_name               TEXT,
    cwd                     TEXT,
    message_id              TEXT
  );

  CREATE TABLE IF NOT EXISTS processed_files (
    path    TEXT PRIMARY KEY,
    mtime   REAL,
    lines   INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
  CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);
  CREATE INDEX IF NOT EXISTS idx_sessions_first ON sessions(first_timestamp);
`

// ─── Types ───────────────────────────────────────────────────────────

interface SessionMeta {
  session_id: string
  project_name: string
  model: string | null
  git_branch: string | null
  first_timestamp: string
  last_timestamp: string
}

interface TurnData {
  session_id: string
  timestamp: string
  model: string | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  tool_name: string | null
  cwd: string | null
  message_id: string | null
}

interface ProcessedFileRow {
  path: string
  mtime: number
  lines: number
}

// ─── DB Path ─────────────────────────────────────────────────────────

/**
 * Get the path to our usage.db
 * Priority: customPath > CLAUDE_TIMELINE_DIR env > ~/.claude-timeline
 */
export function getUsageDbPath(customPath?: string): string {
  if (customPath) return customPath
  const timelineDir = process.env.CLAUDE_TIMELINE_DIR || join(homedir(), ".claude-timeline")
  return join(timelineDir, "usage.db")
}

// ─── Helpers ─────────────────────────────────────────────────────────

function project_name_from_cwd(cwd: string): string {
  if (!cwd) return "unknown"
  const parts = cwd.replace(/\\/g, "/").replace(/\/$/, "").split("/")
  if (parts.length >= 2) return parts.slice(-2).join("/")
  return parts[0] || "unknown"
}

function extractSessionIdFromPath(filePath: string): string | null {
  const match = filePath.match(/([^/]+)\.jsonl$/)
  return match ? match[1] : null
}

// ─── Parser ──────────────────────────────────────────────────────────

/**
 * Parse a JSONL file and return (session_metas, turns, line_count).
 * Deduplicates streaming events by message.id.
 */
function parseJsonlFile(filepath: string): { sessionMeta: SessionMeta[]; turns: TurnData[]; lineCount: number } {
  const seenMessages = new Map<string, TurnData>()
  const turnsNoId: TurnData[] = []
  const sessionMetaMap = new Map<string, SessionMeta>()
  let lineCount = 0

  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs")
    const content = readFileSync(filepath, "utf-8")
    const lines = content.split("\n")

    for (lineCount = 0; lineCount < lines.length; lineCount++) {
      const line = lines[lineCount].trim()
      if (!line) continue

      let record: Record<string, unknown>
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }

      const rtype = record.type as string
      if (rtype !== "assistant" && rtype !== "user") continue

      const sessionId = record.sessionId as string | undefined
      if (!sessionId) continue

      const timestamp = (record.timestamp as string) || ""
      const cwd = (record.cwd as string) || ""
      const gitBranch = (record.gitBranch as string) || ""

      // Update session metadata
      if (!sessionMetaMap.has(sessionId)) {
        sessionMetaMap.set(sessionId, {
          session_id: sessionId,
          project_name: project_name_from_cwd(cwd),
          model: null,
          git_branch: gitBranch || null,
          first_timestamp: timestamp,
          last_timestamp: timestamp,
        })
      } else {
        const meta = sessionMetaMap.get(sessionId)!
        if (timestamp && (!meta.first_timestamp || timestamp < meta.first_timestamp)) {
          meta.first_timestamp = timestamp
        }
        if (timestamp && (!meta.last_timestamp || timestamp > meta.last_timestamp)) {
          meta.last_timestamp = timestamp
        }
        if (gitBranch && !meta.git_branch) {
          meta.git_branch = gitBranch
        }
      }

      if (rtype === "assistant") {
        const msg = (record.message as Record<string, unknown>) || {}
        const usage = (msg.usage as Record<string, unknown>) || {}
        const model = (msg.model as string) || ""
        const messageId = (msg.id as string) || ""

        const inputTokens = (usage.input_tokens as number) || 0
        const outputTokens = (usage.output_tokens as number) || 0
        const cacheRead = (usage.cache_read_input_tokens as number) || 0
        const cacheCreation = (usage.cache_creation_input_tokens as number) || 0

        // Only record turns with actual token usage
        if (inputTokens + outputTokens + cacheRead + cacheCreation === 0) continue

        // Extract tool name from content
        let toolName: string | null = null
        const content = msg.content as Array<Record<string, unknown>> | undefined
        if (Array.isArray(content)) {
          for (const item of content) {
            if (item?.type === "tool_use") {
              toolName = (item.name as string) || null
              break
            }
          }
        }

        if (model) {
          const meta = sessionMetaMap.get(sessionId)
          if (meta) meta.model = model
        }

        const turn: TurnData = {
          session_id: sessionId,
          timestamp,
          model: model || null,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: cacheRead,
          cache_creation_tokens: cacheCreation,
          tool_name: toolName,
          cwd: cwd || null,
          message_id: messageId || null,
        }

        // Dedup: last record per message_id wins
        if (messageId) {
          seenMessages.set(messageId, turn)
        } else {
          turnsNoId.push(turn)
        }
      }
    }
  } catch (e) {
    console.warn(`  Warning: error reading ${filepath}: ${e}`)
  }

  const turns = [...turnsNoId, ...seenMessages.values()]
  return { sessionMeta: Array.from(sessionMetaMap.values()), turns, lineCount }
}

/**
 * Parse only new lines from an updated JSONL file.
 */
function parseJsonlNewLines(
  filepath: string,
  fromLine: number,
): { sessionMeta: SessionMeta[]; turns: TurnData[]; lineCount: number } {
  const seenMessages = new Map<string, TurnData>()
  const turnsNoId: TurnData[] = []
  const sessionMetaMap = new Map<string, SessionMeta>()
  let lineCount = 0

  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs")
    const content = readFileSync(filepath, "utf-8")
    const lines = content.split("\n")

    for (lineCount = 0; lineCount < lines.length; lineCount++) {
      // Skip lines we've already processed
      if (lineCount < fromLine) continue

      const line = lines[lineCount].trim()
      if (!line) continue

      let record: Record<string, unknown>
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }

      const rtype = record.type as string
      if (rtype !== "assistant" && rtype !== "user") continue

      const sessionId = record.sessionId as string | undefined
      if (!sessionId) continue

      const timestamp = (record.timestamp as string) || ""
      const cwd = (record.cwd as string) || ""
      const gitBranch = (record.gitBranch as string) || ""

      // Update session metadata
      if (!sessionMetaMap.has(sessionId)) {
        sessionMetaMap.set(sessionId, {
          session_id: sessionId,
          project_name: project_name_from_cwd(cwd),
          model: null,
          git_branch: gitBranch || null,
          first_timestamp: timestamp,
          last_timestamp: timestamp,
        })
      } else {
        const meta = sessionMetaMap.get(sessionId)!
        if (timestamp && (!meta.last_timestamp || timestamp > meta.last_timestamp)) {
          meta.last_timestamp = timestamp
        }
      }

      if (rtype === "assistant") {
        const msg = (record.message as Record<string, unknown>) || {}
        const usage = (msg.usage as Record<string, unknown>) || {}
        const model = (msg.model as string) || ""
        const messageId = (msg.id as string) || ""

        const inputTokens = (usage.input_tokens as number) || 0
        const outputTokens = (usage.output_tokens as number) || 0
        const cacheRead = (usage.cache_read_input_tokens as number) || 0
        const cacheCreation = (usage.cache_creation_input_tokens as number) || 0

        if (inputTokens + outputTokens + cacheRead + cacheCreation === 0) continue

        let toolName: string | null = null
        const content = msg.content as Array<Record<string, unknown>> | undefined
        if (Array.isArray(content)) {
          for (const item of content) {
            if (item?.type === "tool_use") {
              toolName = (item.name as string) || null
              break
            }
          }
        }

        if (model) {
          const meta = sessionMetaMap.get(sessionId)
          if (meta) meta.model = model
        }

        const turn: TurnData = {
          session_id: sessionId,
          timestamp,
          model: model || null,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: cacheRead,
          cache_creation_tokens: cacheCreation,
          tool_name: toolName,
          cwd: cwd || null,
          message_id: messageId || null,
        }

        if (messageId) {
          seenMessages.set(messageId, turn)
        } else {
          turnsNoId.push(turn)
        }
      }
    }
  } catch (e) {
    console.warn(`  Warning: error reading ${filepath}: ${e}`)
  }

  const turns = [...turnsNoId, ...seenMessages.values()]
  return { sessionMeta: Array.from(sessionMetaMap.values()), turns, lineCount }
}

// ─── Scanner ─────────────────────────────────────────────────────────

export class UsageScanner {
  private db: Database.Database

  constructor(dbPath: string) {
    const { dirname } = require("node:path") as typeof import("node:path")
    const { existsSync, mkdirSync } = require("node:fs") as typeof import("node:fs")
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
   * Scan all JSONL files and populate the DB.
   * Incremental: skips unchanged files.
   */
  async scan(projectsDir: string, verbose = true): Promise<{
    newFiles: number
    updatedFiles: number
    skippedFiles: number
    turnsAdded: number
    sessionsSeen: number
  }> {
    if (!existsSync(projectsDir)) {
      return { newFiles: 0, updatedFiles: 0, skippedFiles: 0, turnsAdded: 0, sessionsSeen: 0 }
    }

    // Find all JSONL files (skip agent-*.jsonl subagent files)
    const jsonlFiles: string[] = []
    const projectDirs = readdirSync(projectsDir)

    for (const dirName of projectDirs) {
      const projectDir = join(projectsDir, dirName)
      try {
        const s = statSync(projectDir)
        if (!s.isDirectory()) continue
      } catch {
        continue
      }

      try {
        const files = readdirSync(projectDir)
        for (const file of files) {
          if (!file.endsWith(".jsonl")) continue
          if (file.startsWith("agent-")) continue
          jsonlFiles.push(join(projectDir, file))
        }
      } catch {
        // Skip unreadable directories
      }
    }

    jsonlFiles.sort()

    let newFiles = 0
    let updatedFiles = 0
    let skippedFiles = 0
    let totalTurns = 0
    const totalSessions = new Set<string>()

    for (const filepath of jsonlFiles) {
      try {
        const st = statSync(filepath)
        const mtime = st.mtimeMs / 1000 // Convert to seconds

        const row = this.db
          .prepare("SELECT mtime, lines FROM processed_files WHERE path = ?")
          .get(filepath) as ProcessedFileRow | undefined

        if (row && Math.abs(row.mtime - mtime) < 0.01) {
          skippedFiles++
          continue
        }

        const isNew = !row
        if (verbose) {
          console.log(`  [${isNew ? "NEW" : "UPD"}] ${filepath}`)
        }

        if (isNew) {
          // Full parse
          const { sessionMeta, turns, lineCount } = parseJsonlFile(filepath)

          if (turns.length > 0 || sessionMeta.length > 0) {
            this.upsertSessions(sessionMeta, turns)
            this.insertTurns(turns)
            for (const s of sessionMeta) totalSessions.add(s.session_id)
            totalTurns += turns.length
            newFiles++
          }

          // Record as processed
          this.db
            .prepare("INSERT OR REPLACE INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)")
            .run(filepath, mtime, lineCount)
        } else {
          // Updated file: parse only new lines
          const oldLines = row!.lines
          const { sessionMeta, turns, lineCount } = parseJsonlNewLines(filepath, oldLines)

          if (lineCount <= oldLines) {
            // File didn't grow
            this.db
              .prepare("UPDATE processed_files SET mtime = ? WHERE path = ?")
              .run(mtime, filepath)
            skippedFiles++
            continue
          }

          if (turns.length > 0 || sessionMeta.length > 0) {
            this.upsertSessions(sessionMeta, turns)
            this.insertTurns(turns)
            for (const s of sessionMeta) totalSessions.add(s.session_id)
            totalTurns += turns.length
          }

          // Update processed record
          this.db
            .prepare("INSERT OR REPLACE INTO processed_files (path, mtime, lines) VALUES (?, ?, ?)")
            .run(filepath, mtime, lineCount)
          updatedFiles++
        }

        this.db.commit()
      } catch (e) {
        console.warn(`  Warning: ${e}`)
      }
    }

    // Recompute session totals from actual turns in DB
    if (newFiles > 0 || updatedFiles > 0) {
      this.db.exec(`
        UPDATE sessions SET
          total_input_tokens = COALESCE((SELECT SUM(input_tokens) FROM turns WHERE turns.session_id = sessions.session_id), 0),
          total_output_tokens = COALESCE((SELECT SUM(output_tokens) FROM turns WHERE turns.session_id = sessions.session_id), 0),
          total_cache_read = COALESCE((SELECT SUM(cache_read_tokens) FROM turns WHERE turns.session_id = sessions.session_id), 0),
          total_cache_creation = COALESCE((SELECT SUM(cache_creation_tokens) FROM turns WHERE turns.session_id = sessions.session_id), 0),
          turn_count = COALESCE((SELECT COUNT(*) FROM turns WHERE turns.session_id = sessions.session_id), 0)
      `)
      this.db.commit()
    }

    if (verbose) {
      console.log(`\nScan complete:`)
      console.log(`  New files:     ${newFiles}`)
      console.log(`  Updated files: ${updatedFiles}`)
      console.log(`  Skipped files: ${skippedFiles}`)
      console.log(`  Turns added:   ${totalTurns}`)
      console.log(`  Sessions seen: ${totalSessions.size}`)
    }

    return {
      newFiles,
      updatedFiles,
      skippedFiles,
      turnsAdded: totalTurns,
      sessionsSeen: totalSessions.size,
    }
  }

  private upsertSessions(sessionMetas: SessionMeta[], turns: TurnData[]): void {
    // Aggregate turn data per session
    const sessionStats = new Map<string, {
      total_input_tokens: number
      total_output_tokens: number
      total_cache_read: number
      total_cache_creation: number
      turn_count: number
      model: string | null
    }>()

    for (const t of turns) {
      if (!sessionStats.has(t.session_id)) {
        sessionStats.set(t.session_id, {
          total_input_tokens: 0,
          total_output_tokens: 0,
          total_cache_read: 0,
          total_cache_creation: 0,
          turn_count: 0,
          model: null,
        })
      }
      const s = sessionStats.get(t.session_id)!
      s.total_input_tokens += t.input_tokens
      s.total_output_tokens += t.output_tokens
      s.total_cache_read += t.cache_read_tokens
      s.total_cache_creation += t.cache_creation_tokens
      s.turn_count++
      if (t.model) s.model = t.model
    }

    const upsert = this.db.prepare(`
      INSERT INTO sessions
        (session_id, project_name, model, turn_count,
         total_input_tokens, total_output_tokens, total_cache_read, total_cache_creation,
         first_timestamp, last_timestamp, git_branch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        last_timestamp = MAX(sessions.last_timestamp, excluded.last_timestamp),
        first_timestamp = MIN(sessions.first_timestamp, excluded.first_timestamp),
        total_input_tokens = total_input_tokens + excluded.total_input_tokens,
        total_output_tokens = total_output_tokens + excluded.total_output_tokens,
        total_cache_read = total_cache_read + excluded.total_cache_read,
        total_cache_creation = total_cache_creation + excluded.total_cache_creation,
        turn_count = turn_count + excluded.turn_count,
        model = CASE
          WHEN excluded.model IS NOT NULL AND excluded.model != 'unknown' THEN excluded.model
          ELSE sessions.model
        END
    `)

    for (const meta of sessionMetas) {
      const stats = sessionStats.get(meta.session_id)
      upsert.run(
        meta.session_id,
        meta.project_name,
        meta.model,
        stats?.turn_count ?? 0,
        stats?.total_input_tokens ?? 0,
        stats?.total_output_tokens ?? 0,
        stats?.total_cache_read ?? 0,
        stats?.total_cache_creation ?? 0,
        meta.first_timestamp,
        meta.last_timestamp,
        meta.git_branch,
      )
    }
  }

  private insertTurns(turns: TurnData[]): void {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO turns
        (session_id, timestamp, model, input_tokens, output_tokens,
         cache_read_tokens, cache_creation_tokens, tool_name, cwd, message_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const t of turns) {
      insert.run(
        t.session_id,
        t.timestamp,
        t.model,
        t.input_tokens,
        t.output_tokens,
        t.cache_read_tokens,
        t.cache_creation_tokens,
        t.tool_name,
        t.cwd,
        t.message_id,
      )
    }
  }

  close(): void {
    this.db.close()
  }
}

// ─── Convenience ─────────────────────────────────────────────────────

/**
 * Scan JSONL files and populate our usage.db.
 * Main entry point for scanner.
 */
export async function scanJsonlFiles(
  projectsDir: string,
  dbPath?: string,
  verbose = true,
): Promise<void> {
  const actualDbPath = dbPath || getUsageDbPath()
  const scanner = new UsageScanner(actualDbPath)
  try {
    await scanner.scan(projectsDir, verbose)
  } finally {
    scanner.close()
  }
}
```

- [ ] **Step 2: Run scanner tests to verify it works**

Run: `pnpm test --filter @claude-timeline/extractor -- scanner`
Expected: Tests pass (we'll write tests in Task 2)

- [ ] **Step 3: Commit**

```bash
git add packages/extractor/src/scanner.ts
git commit -m "feat(extractor): add JSONL scanner for own usage.db"
```

---

### Task 2: Create scanner tests

**Files:**
- Create: `packages/extractor/src/scanner.test.ts`

- [ ] **Step 1: Write scanner unit tests**

```typescript
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { UsageScanner, scanJsonlFiles, getUsageDbPath } from "./scanner.js"

let testDir: string
let dbPath: string
let projectsDir: string

beforeEach(() => {
  testDir = join(tmpdir(), `scanner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
  dbPath = join(testDir, "usage.db")
  projectsDir = join(testDir, "projects")
  mkdirSync(projectsDir, { recursive: true })
})

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {}
})

describe("UsageScanner", () => {
  test("creates DB with schema on construction", () => {
    const scanner = new UsageScanner(dbPath)
    const db = new Database(dbPath, { readonly: true })

    // Verify tables exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>
    const tableNames = tables.map((t) => t.name)
    expect(tableNames).toContain("sessions")
    expect(tableNames).toContain("turns")
    expect(tableNames).toContain("processed_files")

    db.close()
    scanner.close()
  })

  test("scans new JSONL file and populates DB", async () => {
    const projectDir = join(projectsDir, "test-project")
    mkdirSync(projectDir, { recursive: true })

    const sessionId = "test-session-001"
    const jsonlLines = [
      JSON.stringify({
        type: "user",
        sessionId,
        timestamp: "2026-05-10T10:00:00.000Z",
        cwd: "/Users/test/my-project",
        message: { role: "user", content: "Hello" },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId,
        timestamp: "2026-05-10T10:00:05.000Z",
        cwd: "/Users/test/my-project",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          id: "msg-001",
          content: [{ type: "text", text: "Hi there!" }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 200,
            cache_creation_input_tokens: 300,
          },
        },
      }),
    ]
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), jsonlLines.join("\n"))

    const scanner = new UsageScanner(dbPath)
    const result = await scanner.scan(projectsDir, false)

    expect(result.newFiles).toBe(1)
    expect(result.sessionsSeen).toBe(1)

    // Verify session was created
    const db = new Database(dbPath, { readonly: true })
    const session = db
      .prepare("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown>
    expect(session).toBeDefined()
    expect(session.project_name).toBe("my-project")
    expect(session.model).toBe("claude-sonnet-4-6")
    expect(session.turn_count).toBe(1)
    expect(session.total_input_tokens).toBe(100)
    expect(session.total_output_tokens).toBe(50)
    expect(session.total_cache_read).toBe(200)
    expect(session.total_cache_creation).toBe(300)

    // Verify turn was created
    const turns = db
      .prepare("SELECT * FROM turns WHERE session_id = ?")
      .all(sessionId) as Array<Record<string, unknown>>
    expect(turns).toHaveLength(1)
    expect(turns[0].input_tokens).toBe(100)
    expect(turns[0].model).toBe("claude-sonnet-4-6")
    expect(turns[0].message_id).toBe("msg-001")

    db.close()
    scanner.close()
  })

  test("skips unchanged files on re-scan", async () => {
    const projectDir = join(projectsDir, "test-project")
    mkdirSync(projectDir, { recursive: true })

    const sessionId = "test-session-002"
    const jsonlLines = [
      JSON.stringify({
        type: "assistant",
        sessionId,
        timestamp: "2026-05-10T10:00:00.000Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ]
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), jsonlLines.join("\n"))

    const scanner = new UsageScanner(dbPath)

    // First scan
    const result1 = await scanner.scan(projectsDir, false)
    expect(result1.newFiles).toBe(1)
    expect(result1.skippedFiles).toBe(0)

    // Second scan (same files, unchanged)
    const result2 = await scanner.scan(projectsDir, false)
    expect(result2.newFiles).toBe(0)
    expect(result2.skippedFiles).toBe(1)

    scanner.close()
  })

  test("processes updated files incrementally", async () => {
    const projectDir = join(projectsDir, "test-project")
    mkdirSync(projectDir, { recursive: true })

    const sessionId = "test-session-003"
    const filePath = join(projectDir, `${sessionId}.jsonl`)

    // Write initial content
    const line1 = JSON.stringify({
      type: "assistant",
      sessionId,
      timestamp: "2026-05-10T10:00:00.000Z",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        id: "msg-001",
        content: [],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    })
    writeFileSync(filePath, line1 + "\n")

    const scanner = new UsageScanner(dbPath)
    await scanner.scan(projectsDir, false)

    // Append new content
    const line2 = JSON.stringify({
      type: "assistant",
      sessionId,
      timestamp: "2026-05-10T10:00:10.000Z",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        id: "msg-002",
        content: [],
        usage: { input_tokens: 200, output_tokens: 100 },
      },
    })
    writeFileSync(filePath, line1 + "\n" + line2 + "\n")

    // Re-scan
    const result = await scanner.scan(projectsDir, false)
    expect(result.updatedFiles).toBe(1)

    // Verify session was updated (additive)
    const db = new Database(dbPath, { readonly: true })
    const session = db
      .prepare("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown>
    expect(session.turn_count).toBe(2)
    expect(session.total_input_tokens).toBe(300) // 100 + 200
    expect(session.total_output_tokens).toBe(150) // 50 + 100

    // Verify both turns exist
    const turns = db
      .prepare("SELECT * FROM turns WHERE session_id = ?")
      .all(sessionId) as Array<Record<string, unknown>>
    expect(turns).toHaveLength(2)

    db.close()
    scanner.close()
  })

  test("skips agent-*.jsonl subagent files", async () => {
    const projectDir = join(projectsDir, "test-project")
    mkdirSync(projectDir, { recursive: true })

    // Write a subagent file
    const agentLines = [
      JSON.stringify({
        type: "assistant",
        sessionId: "agent-abc123",
        timestamp: "2026-05-10T10:00:00.000Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ]
    writeFileSync(join(projectDir, "agent-abc123.jsonl"), agentLines.join("\n"))

    const scanner = new UsageScanner(dbPath)
    const result = await scanner.scan(projectsDir, false)

    // Should skip the agent file
    expect(result.skippedFiles).toBe(0)
    expect(result.newFiles).toBe(0)

    scanner.close()
  })

  test("deduplicates turns by message_id", async () => {
    const projectDir = join(projectsDir, "test-project")
    mkdirSync(projectDir, { recursive: true })

    const sessionId = "test-session-004"
    const jsonlLines = [
      // First record for msg-001 (partial usage)
      JSON.stringify({
        type: "assistant",
        sessionId,
        timestamp: "2026-05-10T10:00:00.000Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          id: "msg-001",
          content: [],
          usage: { input_tokens: 50, output_tokens: 25 },
        },
      }),
      // Second record for msg-001 (final usage — should win)
      JSON.stringify({
        type: "assistant",
        sessionId,
        timestamp: "2026-05-10T10:00:05.000Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          id: "msg-001",
          content: [],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ]
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), jsonlLines.join("\n"))

    const scanner = new UsageScanner(dbPath)
    await scanner.scan(projectsDir, false)

    // Should only have 1 turn (deduped by message_id)
    const db = new Database(dbPath, { readonly: true })
    const turns = db
      .prepare("SELECT * FROM turns WHERE session_id = ?")
      .all(sessionId) as Array<Record<string, unknown>>
    expect(turns).toHaveLength(1)
    expect(turns[0].input_tokens).toBe(100) // Final usage wins
    expect(turns[0].output_tokens).toBe(50)

    db.close()
    scanner.close()
  })
})

describe("scanJsonlFiles", () => {
  test("creates DB at default path", async () => {
    // This test uses the actual default path — skip if ~/.claude-timeline doesn't exist
    const defaultPath = getUsageDbPath()
    if (!existsSync(join(defaultPath, ".."))) {
      console.log("Skipping: ~/.claude-timeline not found")
      return
    }

    // Just verify the function doesn't throw
    await expect(scanJsonlFiles("/nonexistent-dir", defaultPath, false)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm test --filter @claude-timeline/extractor -- scanner`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/extractor/src/scanner.test.ts
git commit -m "test(extractor): add scanner unit tests"
```

---

## Chunk 2: Update db-reader.ts

### Task 3: Remove listJsonlSessions and update getDbPath

**Files:**
- Modify: `packages/extractor/src/db-reader.ts`
- Modify: `packages/extractor/src/utils.ts`

- [ ] **Step 1: Remove listJsonlSessions from db-reader.ts**

Remove the `listJsonlSessions` function (lines 521-575) and the `getExistingSessionIds` helper (lines 340-354) that was only used by it. Also remove the `parseJsonlSummary` function (lines 360-514) which was only used by `listJsonlSessions`.

The file should keep:
- `computeActiveDurationMs` (used by merger)
- `DbOpenError`, `SessionNotFoundError` (used by tests/merger)
- `getSession` (reads from our DB)
- `getTurns` (reads from our DB)
- `getModelForSession` (reads from our DB)
- `getProcessedFiles` (used by scanner)
- `listSessions` (reads from our DB)
- Remove unused imports: `classifyMessage`, `deduplicateByRequestId`, `calculateSessionCost`, `listSubagentFiles`, `resolveSubagents`, `readFileSync`, `readdirSync`, `statSync`

- [ ] **Step 2: Update utils.ts getDbPath**

Change `getDbPath` in `utils.ts` to return `~/.claude-timeline/usage.db` instead of `~/.claude/usage.db`:

```typescript
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Get the path to our usage.db
 * Priority: customPath > CLAUDE_TIMELINE_DIR env > ~/.claude-timeline
 */
export function getDbPath(customPath?: string): string {
  if (customPath) return customPath
  const timelineDir = process.env.CLAUDE_TIMELINE_DIR || join(homedir(), ".claude-timeline")
  return join(timelineDir, "usage.db")
}

/**
 * Get the path to the projects directory
 * Priority: customPath > CLAUDE_CONFIG_DIR env > ~/.claude
 */
export function getProjectsDir(customPath?: string): string {
  if (customPath) return customPath
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")
  return join(configDir, "projects")
}

/**
 * Encode project name for directory lookup
 * Replaces all '/' with '-' (e.g., '/Users/test' → '-Users-test')
 */
export function encodeProjectName(projectName: string): string {
  return projectName.replaceAll("/", "-")
}

/**
 * Resolve the path to a session's JSONL file
 * Tries multiple encodings to handle DB storing project_name with or without leading '/'
 */
export function resolveSessionJsonlPath(
  session: { projectName: string; sessionId: string },
  projectsDir: string,
): string | null {
  const candidates: string[] = []

  // Direct encoding of what's in the DB
  candidates.push(encodeProjectName(session.projectName))

  // If no leading '/', try with leading '/' (DB sometimes strips it)
  if (!session.projectName.startsWith("/")) {
    candidates.push(encodeProjectName(`/${session.projectName}`))
  }

  // If has leading '/', try without it
  if (session.projectName.startsWith("/")) {
    candidates.push(encodeProjectName(session.projectName.slice(1)))
  }

  // URL-encoded fallback
  candidates.push(encodeURIComponent(session.projectName))

  for (const encoded of candidates) {
    const filePath = join(projectsDir, encoded, `${session.sessionId}.jsonl`)
    if (existsSync(filePath)) return filePath
  }

  return null
}
```

- [ ] **Step 3: Update db-reader tests**

Update `packages/extractor/tests/db-reader.test.ts`:
- Remove `listJsonlSessions` from imports
- Remove all `listJsonlSessions` tests
- Update `getDbPath` test expectations (now points to `~/.claude-timeline/usage.db`)

- [ ] **Step 4: Run tests**

Run: `pnpm test --filter @claude-timeline/extractor -- db-reader`
Expected: Tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/db-reader.ts packages/extractor/src/utils.ts packages/extractor/tests/db-reader.test.ts
git commit -m "refactor(extractor): remove listJsonlSessions, update getDbPath to own DB"
```

---

## Chunk 3: Update merger.ts

### Task 4: Simplify merger.ts

**Files:**
- Modify: `packages/extractor/src/merger.ts`

- [ ] **Step 1: Remove extractJsonlTimeline and simplify extractFullTimeline**

Remove the `extractJsonlTimeline` function (lines 557-711) and the `buildTurnsFromJsonl` helper (lines 459-551) that was only used by it.

The `extractFullTimeline` function stays but no longer needs the fallback — the scanner ensures all sessions are in our DB.

- [ ] **Step 2: Update merger tests**

Update `packages/extractor/tests/merger.test.ts`:
- Remove tests for `extractJsonlTimeline`
- Verify `extractFullTimeline` works with our DB

- [ ] **Step 3: Run tests**

Run: `pnpm test --filter @claude-timeline/extractor -- merger`
Expected: Tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/extractor/src/merger.ts packages/extractor/tests/merger.test.ts
git commit -m "refactor(extractor): remove extractJsonlTimeline, simplify merger"
```

---

## Chunk 4: Update CLI and API

### Task 5: Update CLI with scan command

**Files:**
- Modify: `packages/extractor/src/cli.ts`
- Modify: `packages/extractor/src/index.ts`

- [ ] **Step 1: Add scan subcommand to cli.ts**

Add a new `scan` command:
```typescript
// scan subcommand
program
  .command("scan")
  .description("Scan JSONL files and populate usage.db")
  .option("--projects-dir <dir>", "Projects directory")
  .option("--db-path <path>", "Usage DB path")
  .action(async (opts) => {
    const { scanJsonlFiles } = await import("./scanner.js")
    const projectsDir = opts.projectsDir || getProjectsDir()
    const dbPath = opts.dbPath || getUsageDbPath()

    console.log("")
    console.log("  Scanning JSONL files...")
    console.log("")

    await scanJsonlFiles(projectsDir, dbPath, true)

    console.log("")
    console.log(`  Database: ${dbPath}`)
    console.log("")
  })
```

- [ ] **Step 2: Simplify list and extract commands**

Remove the DB+JSONL merge logic from `list` and `extract` commands. They now just read from our DB.

- [ ] **Step 3: Update index.ts exports**

Export scanner functions from `index.ts`.

- [ ] **Step 4: Run tests**

Run: `pnpm test --filter @claude-timeline/extractor`
Expected: Tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/cli.ts packages/extractor/src/index.ts
git commit -m "feat(extractor): add scan command, simplify list/extract"
```

### Task 6: Update API server

**Files:**
- Modify: `packages/api/src/serve.ts`
- Modify: `packages/api/src/config.ts`

- [ ] **Step 1: Add startup scan to serve.ts**

```typescript
import { scanJsonlFiles } from "@claude-timeline/extractor/scanner"

async function main() {
  const config = loadConfig()
  const app = express()

  // Scan JSONL files on startup
  console.log("  Scanning JSONL files...")
  await scanJsonlFiles(config.projectsDir, config.usageDbPath, false)
  console.log("")

  app.use(cors({ origin: config.corsOrigins }))
  app.use(express.json())

  mountApiRoutes(app, config)
  // ... rest of server setup
}
```

- [ ] **Step 2: Update config.ts**

Replace `dbPath` with `usageDbPath`:
```typescript
export interface Config {
  port: number
  corsOrigins: string[]
  usageDbPath: string  // was dbPath
  projectsDir: string
  costStreamDbPath: string
  costMethod: "api" | "estimated" | "auto"
}
```

- [ ] **Step 3: Update API routes**

Remove all references to Claude Code's `usage.db`. Update session listing to read from our DB only.

- [ ] **Step 4: Run tests**

Run: `pnpm test --filter @claude-timeline/api`
Expected: Tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/serve.ts packages/api/src/config.ts
git commit -m "feat(api): add startup scan, use own usage.db"
```

---

## Chunk 5: Cleanup and Final Testing

### Task 7: Remove old DB references

**Files:**
- Modify: `packages/extractor/src/index.ts`
- Modify: `README.md`

- [ ] **Step 1: Remove old --db-path flag from index.ts**

Remove the `--db-path` CLI option that pointed to `~/.claude/usage.db`.

- [ ] **Step 2: Update README.md**

Remove references to Claude Code's `usage.db`. Document our own `~/.claude-timeline/usage.db`.

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/extractor/src/index.ts README.md
git commit -m "chore: remove old usage.db references, update docs"
```

### Task 8: Integration test with real data

- [ ] **Step 1: Manual test with real JSONL files**

Run: `npx claude-timeline scan`
Verify: Session count matches expected, DB created at `~/.claude-timeline/usage.db`

- [ ] **Step 2: Start server and verify**

Run: `npx claude-timeline serve`
Verify: Sessions load correctly, no errors in console

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: integration fixes for own usage.db"
```
