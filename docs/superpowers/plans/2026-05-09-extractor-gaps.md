# Extractor Gap Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 documented gaps in the session extractor: commandExecuted extraction, cache 5m/1h breakdown, list-sessions CLI, processed_files integration, and stale task docs.

**Architecture:** Each task is independent and can be implemented in any order. Tasks 1-4 modify source code in `extractor/src/` and `extractor/tests/`. Task 5 updates documentation only.

**Tech Stack:** TypeScript, Node.js, vitest, better-sqlite3, minimist

---

## File Map

| File | Changes |
|------|---------|
| `extractor/src/jsonl-parser.ts` | Task 1 (commandExecuted), Task 2 (cache 5m/1h) |
| `extractor/src/types.ts` | Task 2 (add cacheCreation5m/1h to TokenUsage from JSONL) |
| `extractor/src/merger.ts` | Task 1 (extract commandExecuted), Task 2 (merge cache breakdown) |
| `extractor/src/db-reader.ts` | Task 2 (read processed_files for session list) |
| `extractor/src/index.ts` | Task 3 (--list-sessions flag) |
| `extractor/tests/jsonl-parser.test.ts` | Task 1, Task 2 |
| `extractor/tests/merger.test.ts` | Task 1, Task 2 |
| `extractor/tests/db-reader.test.ts` | Task 2 |
| `extractor/tests/index.test.ts` | Task 3 |
| `.dex/tasks.jsonl` | Task 5 (update stale descriptions) |

---

## Task 1: Extract `commandExecuted` from JSONL

**Problem:** `SessionMetadata.commandExecuted` is always `undefined`. The session report shows `Command Executed: /claude-hud:setup` but we never extract it.

**Source:** The first user message in the JSONL contains `<command-name>/claude-hud:setup</command-name>`.

**Files:**
- Modify: `extractor/src/merger.ts`
- Modify: `extractor/tests/merger.test.ts`

- [ ] **Step 1: Write failing test for commandExecuted extraction**

Add to `extractor/tests/merger.test.ts`:

```typescript
describe("extractCommandExecuted", () => {
  it("should extract command from first user message with command-name tag", () => {
    const messages: RawJsonlRecord[] = [
      {
        type: "user",
        uuid: "1",
        timestamp: "2026-05-07T19:22:39.000Z",
        message: {
          role: "user",
          content: "<command-message>claude-hud:setup</command-message>\n<command-name>/claude-hud:setup</command-name>",
        },
      },
    ]
    const result = extractCommandExecuted(messages)
    expect(result).toBe("/claude-hud:setup")
  })

  it("should return undefined for sessions without command", () => {
    const messages: RawJsonlRecord[] = [
      {
        type: "user",
        uuid: "1",
        timestamp: "2026-05-07T19:22:39.000Z",
        message: { role: "user", content: "Fix the bug in auth.ts" },
      },
    ]
    const result = extractCommandExecuted(messages)
    expect(result).toBeUndefined()
  })

  it("should return undefined for empty messages", () => {
    expect(extractCommandExecuted([])).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/merger.test.ts`
Expected: FAIL — `extractCommandExecuted` not defined

- [ ] **Step 3: Implement extractCommandExecuted in merger.ts**

Add to `extractor/src/merger.ts`:

```typescript
/**
 * Extract commandExecuted from the first user message.
 * Looks for <command-name>/...</command-name> tags in content.
 */
export function extractCommandExecuted(messages: RawJsonlRecord[]): string | undefined {
  for (const msg of messages) {
    if (msg.type !== "user") continue
    const content = msg.message?.content
    if (typeof content !== "string") continue
    const match = content.match(/<command-name>(.+?)<\/command-name>/)
    if (match) return match[1]
    // No command tag found in first user message — stop looking
    break
  }
  return undefined
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/merger.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into extractFullTimeline**

In `extractor/src/merger.ts`, update `extractFullTimeline` to set `commandExecuted` on the session:

```typescript
// After getting JSONL result, before returning:
const commandExecuted = extractCommandExecuted(jsonlResult?.rawMessages ?? [])

return {
  session: { ...session, commandExecuted },
  turns: enrichedTurns,
  pricing,
}
```

- [ ] **Step 6: Run full test suite**

Run: `pnpm test`
Expected: All 83+ tests pass

- [ ] **Step 7: Commit**

```bash
git add extractor/src/merger.ts extractor/tests/merger.test.ts
git commit -m "feat(merger): extract commandExecuted from JSONL"
```

---

## Task 2: Cache Creation 5m/1h Breakdown from JSONL

**Problem:** The JSONL has `cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens` but we ignore them. All cache creation goes into `cacheCreation5mTokens`. For the example session, the JSONL shows 1h cache (12973 tokens), not 5m — so pricing is wrong for 1h sessions.

**JSONL structure:**
```json
{
  "message": {
    "usage": {
      "cache_creation": {
        "ephemeral_5m_input_tokens": 0,
        "ephemeral_1h_input_tokens": 12973
      }
    }
  }
}
```

**Files:**
- Modify: `extractor/src/jsonl-parser.ts` — extract cache_creation breakdown
- Modify: `extractor/src/types.ts` — add `cacheCreation5m`/`cacheCreation1h` to `RawJsonlRecord.message.usage`
- Modify: `extractor/src/merger.ts` — use JSONL breakdown when available, fall back to DB total
- Modify: `extractor/tests/jsonl-parser.test.ts` — test extraction
- Modify: `extractor/tests/merger.test.ts` — test merge logic

- [ ] **Step 1: Write failing test for cache breakdown extraction**

Add to `extractor/tests/jsonl-parser.test.ts`:

```typescript
it("should extract cache_creation 5m/1h breakdown from message.usage", () => {
  const content = JSON.stringify({
    type: "assistant",
    uuid: "1",
    timestamp: "2026-05-07T19:22:45.118Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
      usage: {
        input_tokens: 2,
        output_tokens: 323,
        cache_read_input_tokens: 12143,
        cache_creation_input_tokens: 12973,
        cache_creation: {
          ephemeral_5m_input_tokens: 0,
          ephemeral_1h_input_tokens: 12973,
        },
      },
    },
  })
  fs.writeFileSync(jsonlPath, content)

  const result = parseSessionJsonl(jsonlPath, "session-1")
  expect(result).not.toBeNull()
  expect(result?.rawMessages[0].message?.usage?.cacheCreation5mTokens).toBe(0)
  expect(result?.rawMessages[0].message?.usage?.cacheCreation1hTokens).toBe(12973)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/jsonl-parser.test.ts`
Expected: FAIL — `cacheCreation5mTokens` is undefined

- [ ] **Step 3: Update TokenUsage in types.ts**

The `TokenUsage` interface already has `cacheCreation5mTokens` and `cacheCreation1hTokens`. But `RawJsonlRecord.message.usage` uses the raw JSONL shape. Add a normalized field to the usage type in `RawJsonlRecord`:

In `extractor/src/types.ts`, update the `message.usage` type inside `RawJsonlRecord`:

```typescript
export interface RawJsonlRecord {
  // ... existing fields ...
  message?: {
    role: string
    content: Array<Record<string, unknown>>
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
      cache_creation?: {
        ephemeral_5m_input_tokens?: number
        ephemeral_1h_input_tokens?: number
      }
      // Normalized fields (populated by parser)
      cacheCreation5mTokens?: number
      cacheCreation1hTokens?: number
    }
  }
  // ... rest ...
}
```

- [ ] **Step 4: Update jsonl-parser.ts to normalize cache breakdown**

In `extractor/src/jsonl-parser.ts`, after pushing to `rawMessages`, normalize the usage:

```typescript
// After: rawMessages.push(record)
// Normalize cache creation breakdown from JSONL
if (record.message?.usage?.cache_creation) {
  const cc = record.message.usage.cache_creation
  record.message.usage.cacheCreation5mTokens = cc.ephemeral_5m_input_tokens ?? 0
  record.message.usage.cacheCreation1hTokens = cc.ephemeral_1h_input_tokens ?? 0
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- tests/jsonl-parser.test.ts`
Expected: PASS

- [ ] **Step 6: Write failing test for merger using JSONL breakdown**

Add to `extractor/tests/merger.test.ts`:

```typescript
it("should prefer JSONL cache breakdown over DB total", () => {
  const dbTurns: Turn[] = [{
    timestamp: "2026-05-07T19:22:45.118Z",
    tokenUsage: {
      inputTokens: 2,
      outputTokens: 323,
      cacheReadTokens: 12143,
      cacheCreation5mTokens: 12973, // DB has total, no split
      cacheCreation1hTokens: 0,
    },
    messages: [],
    toolCalls: [],
    cacheWriteType: "5m",
    cacheReadType: "5m",
    cacheCreationTokensThisTurn: 12973,
  }]

  const jsonlMessages: RawJsonlRecord[] = [{
    type: "assistant",
    uuid: "1",
    timestamp: "2026-05-07T19:22:45.118Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
      usage: {
        cache_creation: {
          ephemeral_5m_input_tokens: 0,
          ephemeral_1h_input_tokens: 12973,
        },
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 12973,
      },
    },
  }]

  const result = matchTurnsToMessages(dbTurns, jsonlMessages)
  expect(result[0].tokenUsage.cacheCreation5mTokens).toBe(0)
  expect(result[0].tokenUsage.cacheCreation1hTokens).toBe(12973)
})
```

- [ ] **Step 7: Implement cache breakdown merge in matchTurnsToMessages**

In `extractor/src/merger.ts`, inside `matchTurnsToMessages`, after matching messages to turns, apply JSONL cache breakdown:

```typescript
// After building normalizedMessages, before returning the turn:
// Apply JSONL cache breakdown if available
for (const msg of matchedMessages) {
  const usage = msg.message?.usage
  if (usage?.cacheCreation5mTokens !== undefined || usage?.cacheCreation1hTokens !== undefined) {
    return {
      ...turn,
      messages: normalizedMessages,
      toolCalls: matchedToolCalls,
      tokenUsage: {
        ...turn.tokenUsage,
        cacheCreation5mTokens: usage.cacheCreation5mTokens ?? turn.tokenUsage.cacheCreation5mTokens,
        cacheCreation1hTokens: usage.cacheCreation1hTokens ?? turn.tokenUsage.cacheCreation1hTokens,
      },
    }
  }
}
```

- [ ] **Step 8: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 9: Verify with real session**

Run: `pnpm extract -- --session-id 19500eaa-3cc6-4111-a82d-f158e7f76ad3 | python3 -c "import sys,json; d=json.load(sys.stdin); t=d['turns'][0]; print(f'5m: {t[\"tokenUsage\"][\"cacheCreation5mTokens\"]}, 1h: {t[\"tokenUsage\"][\"cacheCreation1hTokens\"]}')"`
Expected: `5m: 0, 1h: 12973`

- [ ] **Step 10: Commit**

```bash
git add extractor/src/types.ts extractor/src/jsonl-parser.ts extractor/src/merger.ts extractor/tests/jsonl-parser.test.ts extractor/tests/merger.test.ts
git commit -m "feat(pricing): extract cache 5m/1h breakdown from JSONL"
```

---

## Task 3: `--list-sessions` CLI Flag

**Problem:** No way to discover sessions without knowing the ID. User must query SQLite manually.

**Files:**
- Modify: `extractor/src/db-reader.ts` — add `listSessions()` function
- Modify: `extractor/src/index.ts` — add `--list-sessions` flag
- Modify: `extractor/tests/db-reader.test.ts` — test listSessions
- Modify: `extractor/tests/index.test.ts` — test flag parsing

- [ ] **Step 1: Write failing test for listSessions**

Add to `extractor/tests/db-reader.test.ts`:

```typescript
describe("listSessions", () => {
  test("returns sessions ordered by last_timestamp desc", () => {
    const db = new Database(dbPath)
    db.exec(`
      INSERT INTO sessions VALUES (
        'session-2', 'test-project', 1, 10, 500, 1000, 500,
        '2026-05-08T10:00:00.000Z'
      )
    `)
    db.close()

    const sessions = listSessions(dbPath)
    expect(sessions.length).toBeGreaterThanOrEqual(2)
    // Most recent first
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/db-reader.test.ts`
Expected: FAIL — `listSessions` not defined

- [ ] **Step 3: Implement listSessions in db-reader.ts**

Add to `extractor/src/db-reader.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/db-reader.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for --list-sessions flag**

Add to `extractor/tests/index.test.ts`:

```typescript
it("should parse --list-sessions flag", () => {
  const config = parseArgs(["node", "src/index.ts", "--list-sessions"])
  expect(config.listSessions).toBe(true)
  expect(config.sessionId).toBeNull()
})

it("should not require --session-id when --list-sessions is set", () => {
  expect(() => parseArgs(["node", "src/index.ts", "--list-sessions"])).not.toThrow()
})
```

- [ ] **Step 6: Update parseArgs in index.ts**

In `extractor/src/index.ts`, update `Config` and `parseArgs`:

```typescript
export interface Config {
  sessionId: string | null
  dbPath: string
  projectsDir: string
  outputPath: string | null
  listSessions: boolean
}

export function parseArgs(argv: string[]): Config {
  const args = minimist(argv.slice(2))

  const listSessions = Boolean(args["list-sessions"])

  if (!listSessions && !args["session-id"]) {
    throw new Error(
      "Error: --session-id is required (or use --list-sessions).\n" +
        "Usage: tsx src/index.ts --session-id <id> [options]\n" +
        "       tsx src/index.ts --list-sessions\n" +
        "Options:\n" +
        "  --db-path <path>        SQLite DB path (default: ~/.claude/usage.db)\n" +
        "  --projects-dir <path>   Projects directory (default: ~/.claude/projects)\n" +
        "  --output <path>         Write JSON to file instead of stdout\n" +
        "  --list-sessions         List recent sessions and exit",
    )
  }

  return {
    sessionId: args["session-id"] || null,
    dbPath: args["db-path"] || getDbPath(),
    projectsDir: args["projects-dir"] || getProjectsDir(),
    outputPath: args.output || null,
    listSessions,
  }
}
```

- [ ] **Step 7: Update main() to handle --list-sessions**

In `extractor/src/index.ts`, update `main()`:

```typescript
async function main(): Promise<void> {
  const config = parseArgs(process.argv)

  if (config.listSessions) {
    const { listSessions } = await import("./db-reader.js")
    const sessions = listSessions(config.dbPath)
    outputJSON(sessions, config.outputPath)
    return
  }

  const data = await extractFullTimeline(config.sessionId!, config.dbPath, config.projectsDir)
  outputJSON(data, config.outputPath)
}
```

- [ ] **Step 8: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 9: Verify with real DB**

Run: `rtk npx tsx src/index.ts --list-sessions`
Expected: JSON array of recent sessions with sessionId, model, turnCount, totalCostEstimate

- [ ] **Step 10: Commit**

```bash
git add extractor/src/db-reader.ts extractor/src/index.ts extractor/tests/db-reader.test.ts extractor/tests/index.test.ts
git commit -m "feat(cli): add --list-sessions flag"
```

---

## Task 4: `processed_files` Table Integration

**Problem:** The `processed_files` table in `usage.db` tracks which JSONL files have been processed (path, mtime, lines). This is useful for session discovery — finding all available sessions without scanning directories.

**Schema:**
```sql
CREATE TABLE processed_files (
    path    TEXT PRIMARY KEY,
    mtime   REAL,
    lines   INTEGER
);
```

The `path` column contains the full JSONL path (e.g., `~/.claude/projects/-Users-abnersoaresalvesjunior/19500eaa-...jsonl`). The session ID can be extracted from the filename.

**Files:**
- Modify: `extractor/src/db-reader.ts` — add `getProcessedFiles()` function
- Modify: `extractor/tests/db-reader.test.ts` — test it

- [ ] **Step 1: Write failing test for getProcessedFiles**

Add to `extractor/tests/db-reader.test.ts`:

```typescript
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
        '/Users/test/.claude/projects/-Users-test/abc-123.jsonl',
        1778182387.61482,
        135
      )
    `)
    db.close()

    const files = getProcessedFiles(dbPath)
    expect(files.length).toBe(1)
    expect(files[0].path).toContain("abc-123.jsonl")
    expect(files[0].lines).toBe(135)
    expect(files[0].sessionId).toBe("abc-123")
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/db-reader.test.ts`
Expected: FAIL — `getProcessedFiles` not defined

- [ ] **Step 3: Implement getProcessedFiles in db-reader.ts**

Add to `extractor/src/db-reader.ts`:

```typescript
/** Processed file entry */
export interface ProcessedFile {
  path: string
  mtime: number
  lines: number
  sessionId: string | null
}

/**
 * Get processed files from the DB.
 * Returns empty array if table doesn't exist.
 */
export function getProcessedFiles(dbPath: string): ProcessedFile[] {
  let db: Database.Database
  try {
    db = new Database(dbPath, { readonly: true })
  } catch (_err) {
    throw new DbOpenError(`Failed to open database: ${dbPath}`)
  }

  try {
    // Check if table exists
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

/**
 * Extract session ID from JSONL file path.
 * e.g., '/.../abc-123.jsonl' → 'abc-123'
 */
function extractSessionIdFromPath(filePath: string): string | null {
  const match = filePath.match(/([0-9a-f-]{36})\.jsonl$/)
  return match ? match[1] : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/db-reader.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add extractor/src/db-reader.ts extractor/tests/db-reader.test.ts
git commit -m "feat(db): add getProcessedFiles for session discovery"
```

---

## Task 5: Update Stale Dex Task Descriptions

**Problem:** The `.dex/tasks.jsonl` file has stale JSONL structure assumptions:
- Task `48maqv1e` (JSONL Parser) describes `toolUseResult.toolUseId` — real JSONL uses `parentUuid` matching
- Task `48maqv1e` describes `toolUseResult.content` — real JSONL uses `stdout`/`stderr`
- Task `36i1fawm` (Types) describes `toolUseResult: { toolUseId, content, isError? }` — real structure is `{ stdout, stderr, interrupted, isImage, noOutputExpected }`

**Files:**
- Modify: `.dex/tasks.jsonl`

- [ ] **Step 1: Update task 48maqv1e (JSONL Parser) description**

Update the description in `.dex/tasks.jsonl` for task `48maqv1e` to reflect the real JSONL structure:

**Old (stale):**
```
- If toolUseResult exists → match to existing toolCall by toolUseId, set result + isError
```

**New (correct):**
```
- If toolUseResult exists AND parentUuid is set → find assistant message by uuid matching parentUuid → attach result to tool calls from that assistant message
- toolUseResult structure: { stdout, stderr, interrupted, isImage, noOutputExpected } (for Bash), { type, file } (for Read), { questions, answers } (for AskUserQuestion)
- tool_use blocks use `id` field (not `toolUseId`) for the tool call identifier
```

- [ ] **Step 2: Update task 36i1fawm (Types) description**

Update the `RawJsonlRecord` description in task `36i1fawm`:

**Old (stale):**
```
- toolUseResult?: { toolUseId, content, isError? }
```

**New (correct):**
```
- toolUseResult?: Record<string, unknown> — structure varies by tool type:
  - Bash: { stdout, stderr, interrupted, isImage, noOutputExpected }
  - Read: { type, file }
  - AskUserQuestion: { questions, answers }
  - Edit/Write: { filePath, oldString, newString, ... }
- Matching: use parentUuid (on user entry) → uuid (on assistant entry), NOT toolUseId
```

- [ ] **Step 3: Commit**

```bash
git add .dex/tasks.jsonl
git commit -m "docs(dex): fix stale JSONL structure in task descriptions"
```

---

## Verification

After all tasks, run:

```bash
# All tests pass
pnpm test

# Type check clean
pnpm typecheck

# CLI works end-to-end
rtk npx tsx src/index.ts --list-sessions
rtk npx tsx src/index.ts --session-id 19500eaa-3cc6-4111-a82d-f158e7f76ad3 | python3 -c "
import sys, json
d = json.load(sys.stdin)
s = d['session']
print(f'commandExecuted: {s.get(\"commandExecuted\")}')
print(f'turn 0 cache 5m: {d[\"turns\"][0][\"tokenUsage\"][\"cacheCreation5mTokens\"]}')
print(f'turn 0 cache 1h: {d[\"turns\"][0][\"tokenUsage\"][\"cacheCreation1hTokens\"]}')
print(f'total cost: \${d[\"pricing\"][\"totalCost\"]:.4f}')
"
```

Expected output:
```
commandExecuted: /claude-hud:setup
turn 0 cache 5m: 0
turn 0 cache 1h: 12973
total cost: $0.6260
```
