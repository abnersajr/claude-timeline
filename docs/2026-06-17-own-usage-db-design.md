# Own Usage DB — Design Spec

> Replace dependency on Claude Code's `~/.claude/usage.db` with our own indexed DB at `~/.claude-timeline/usage.db`.

## Problem

The current `db-reader.ts` reads from `~/.claude/usage.db`, which is not an official Claude Code artifact — it's from a third-party project (phuryn/claude-usage). This creates:
- Confusion about data ownership
- Dependency on an external schema we don't control
- Risk of breakage if that project changes

## Goal

Build our own `usage.db` at `~/.claude-timeline/usage.db` that indexes JSONL files. The JSONL files remain the source of truth; our DB is a performance index for fast reads.

## Design

### DB Location

`~/.claude-timeline/usage.db` — alongside existing `cost-stream.db`.

### Schema

```sql
-- Session-level aggregates (one row per session)
CREATE TABLE sessions (
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

-- Per-turn data (multiple rows per session)
CREATE TABLE turns (
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

-- Incremental scan tracking
CREATE TABLE processed_files (
  path    TEXT PRIMARY KEY,
  mtime   REAL,
  lines   INTEGER
);

CREATE INDEX idx_turns_session ON turns(session_id);
CREATE INDEX idx_turns_timestamp ON turns(timestamp);
CREATE INDEX idx_sessions_first ON sessions(first_timestamp);
```

### Scanner Module

New file: `packages/extractor/src/scanner.ts`

**Key function: `scanJsonlFiles(projectsDir, dbPath)`**

Flow:
1. Glob `~/.claude/projects/**/*.jsonl` (skip `agent-*.jsonl`)
2. For each file: check `processed_files` table (mtime + lines)
3. Skip unchanged files
4. Parse new/changed files using existing JSONL parsing logic
5. Extract turns, aggregate into session summaries
6. Upsert sessions, insert new turns (dedup by `message_id`)
7. Update `processed_files` record

**Incremental update:**
- New file → full parse
- Updated file → parse only new lines (from stored line count)
- Unchanged file → skip entirely

**When it runs:**
1. Server startup — scan before mounting routes
2. CLI `claude-timeline scan` — manual scan command
3. `/api/sessions` — re-scan if last scan > 5 minutes ago

### Integration Changes

#### `db-reader.ts`
- Remove `listJsonlSessions()` — no longer needed
- `getSession()`, `getTurns()`, `listSessions()` — same signatures, read from our DB
- `getProcessedFiles()` — stays, used by scanner
- `getDbPath()` — returns `~/.claude-timeline/usage.db`

#### `merger.ts`
- `extractFullTimeline()` — reads from our DB directly
- Remove `extractJsonlTimeline()` — separate path no longer needed

#### `utils.ts`
- `getDbPath()` → returns `~/.claude-timeline/usage.db`
- `getProjectsDir()` → stays the same

#### `cli.ts`
- Add `claude-timeline scan` subcommand
- Simplify `list` and `extract` commands (no more DB+JSONL merge)

#### `serve.ts`
- Startup: call `scanJsonlFiles()` before mounting routes
- `/api/sessions`: check staleness, re-scan if needed
- Remove all references to `~/.claude/usage.db`

#### Config
- Remove `dbPath` config pointing to `~/.claude/usage.db`
- Add `usageDbPath` pointing to `~/.claude-timeline/usage.db`

### Data NOT in DB (computed at runtime from JSONL)
- `is_ongoing` — detected from JSONL message patterns
- `total_cost` — calculated from tokens × pricing rates
- `has_thinking` — detected from JSONL content blocks
- `active_duration_ms` — computed from turn timestamp gaps
- `context_stats`, `conversation_groups`, `subagents` — derived from JSONL

### Migration
- No migration needed — fresh DB created on first scan
- Old `~/.claude/usage.db` is simply no longer read
- JSONL files are untouched

### Testing
- Unit tests for scanner (parse, aggregate, upsert)
- Integration tests with real JSONL fixtures
- Verify incremental scan skips unchanged files
- Verify session listing matches previous behavior
