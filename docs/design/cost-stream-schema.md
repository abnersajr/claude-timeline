# Cost Data from Stdin — SQLite Schema & Data Flow

> **Status:** Draft
> **Created:** 2026-05-11
> **Depends on:** `extractor/src/types.ts`, `extractor/src/pricing.ts`

## Context

Claude Code sends JSON to plugins via stdin every ~300ms. This stream includes cost data with fields like `cost.total_cost_usd` and `modelUsage` (per-model token breakdown). This data represents **ground-truth costs** from the API — unlike the extractor's current approach of computing costs from token counts in `usage.db`.

We need a SQLite schema to capture this data so the extractor can merge it with JSONL-derived data for more accurate cost reporting.

## Existing Schema Summary

The extractor currently reads from two sources:

1. **`usage.db`** (Claude Code's SQLite, read-only):
   - `sessions`: session_id, project_name, turn_count, total_input/output/cache_read/cache_creation tokens, first/last timestamp, git_branch, model
   - `turns`: session_id, timestamp, tool_name, cwd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, model

2. **JSONL files** (`~/.claude/projects/{encoded-project}/{session-id}.jsonl`):
   - Full message content, tool calls, usage per message, model per message

The extractor merges these via `matchTurnsToMessages()` — matching SQLite turns to JSONL messages by timestamp, then computing costs in `pricing.ts` using a static pricing table.

**Gap:** The extractor computes costs from token counts × pricing rates. It has no access to the actual dollar amounts that Claude Code knows. Stdin cost data fills this gap.

## Stdin JSON Shape (from Claude Code)

Claude Code sends JSON objects to plugin stdin. The cost-relevant fields:

```json
{
  "cost": {
    "total_cost_usd": 1.2345,
    "input_cost_usd": 0.123,
    "output_cost_usd": 0.456,
    "cache_read_cost_usd": 0.078,
    "cache_creation_cost_usd": 0.567
  },
  "modelUsage": {
    "claude-sonnet-4-6": {
      "input_tokens": 12345,
      "output_tokens": 6789,
      "cache_read_tokens": 90123,
      "cache_creation_tokens": 3456
    },
    "claude-haiku-4-5": {
      "input_tokens": 5678,
      "output_tokens": 1234,
      "cache_read_tokens": 0,
      "cache_creation_tokens": 0
    }
  },
  "session_id": "...",
  "timestamp": "..."
}
```

Note: These fields are illustrative — the exact shape depends on what Claude Code sends. The schema should be flexible enough to store whatever is provided.

## Proposed SQLite Schema

We add tables to a **new SQLite database** (`~/.claude/cost-stream.db`) rather than modifying the read-only `usage.db`.

### Table: `cost_snapshots`

Stores each stdin message as a point-in-time snapshot. These arrive every ~300ms, so we use UPSERT to only keep the latest snapshot per session (or store all for time-series analysis).

```sql
CREATE TABLE IF NOT EXISTS cost_snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT NOT NULL,
  timestamp       TEXT NOT NULL,  -- ISO 8601
  total_cost_usd  REAL NOT NULL DEFAULT 0,
  input_cost_usd  REAL NOT NULL DEFAULT 0,
  output_cost_usd REAL NOT NULL DEFAULT 0,
  cache_read_cost_usd    REAL NOT NULL DEFAULT 0,
  cache_creation_cost_usd REAL NOT NULL DEFAULT 0,
  raw_json        TEXT,           -- original stdin JSON for debugging
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cost_snapshots_session
  ON cost_snapshots(session_id, timestamp);
```

### Table: `model_usage_snapshots`

Per-model token breakdown for each cost snapshot. One row per model per snapshot.

```sql
CREATE TABLE IF NOT EXISTS model_usage_snapshots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id        TEXT NOT NULL,
  snapshot_id       INTEGER NOT NULL REFERENCES cost_snapshots(id),
  timestamp         TEXT NOT NULL,  -- ISO 8601
  model             TEXT NOT NULL,
  input_tokens      INTEGER NOT NULL DEFAULT 0,
  output_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_model_usage_session
  ON model_usage_snapshots(session_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_model_usage_snapshot
  ON model_usage_snapshots(snapshot_id);
```

### Table: `session_cost_summary`

Aggregated cost summary per session (latest known state). Updated on each snapshot.

```sql
CREATE TABLE IF NOT EXISTS session_cost_summary (
  session_id        TEXT PRIMARY KEY,
  total_cost_usd    REAL NOT NULL DEFAULT 0,
  input_cost_usd    REAL NOT NULL DEFAULT 0,
  output_cost_usd   REAL NOT NULL DEFAULT 0,
  cache_read_cost_usd     REAL NOT NULL DEFAULT 0,
  cache_creation_cost_usd REAL NOT NULL DEFAULT 0,
  snapshot_count    INTEGER NOT NULL DEFAULT 0,
  first_snapshot_at TEXT,
  last_snapshot_at  TEXT,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Table: `processed_stdin_files`

Tracks which stdin JSON files have been processed (for batch reprocessing).

```sql
CREATE TABLE IF NOT EXISTS processed_stdin_files (
  file_path  TEXT PRIMARY KEY,
  mtime      REAL NOT NULL,
  session_id TEXT,
  processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Data Flow

### Real-time Capture (stdin → SQLite)

```
Claude Code stdin JSON (every ~300ms)
    │
    ▼
cost-stream-capture.ts
    │  - Parse JSON from stdin
    │  - Extract cost.total_cost_usd
    │  - Extract modelUsage map
    │  - Open/create cost-stream.db
    │
    ├─→ INSERT INTO cost_snapshots (...)
    │
    ├─→ For each model in modelUsage:
    │     INSERT INTO model_usage_snapshots (...)
    │
    └─→ UPSERT INTO session_cost_summary (...)
```

### Batch Capture (replay from saved stdin logs)

```
Saved stdin JSONL file
    │
    ▼
cost-stream-capture.ts --batch <file>
    │  - Read each line
    │  - Same insert logic as real-time
    │  - Skip duplicates (session_id + timestamp)
```

### Extractor Merge (cost-stream.db + usage.db + JSONL → FullTimelineSession)

```
                    ┌─────────────────┐
                    │  cost-stream.db │  (ground-truth USD costs)
                    └────────┬────────┘
                             │
┌─────────────┐    ┌────────▼────────┐    ┌──────────────┐
│  usage.db   │───▶│    merger.ts    │◀───│  JSONL files  │
│ (SQLite)    │    │  extractFull    │    │  (messages)  │
└─────────────┘    │   Timeline()    │    └──────────────┘
                   └────────┬────────┘
                            │
                            ▼
                   FullTimelineSession
                   with actual USD costs
```

### Merge Logic

The merger would use cost-stream data to **override** the estimated pricing:

```typescript
// In merger.ts — extractFullTimeline()

// 1. Get cost-stream data (if available)
const costData = getCostSummary(costStreamDbPath, sessionId)

// 2. Get existing session + turns from usage.db
const session = getSession(dbPath, sessionId)
const turns = getTurns(dbPath, sessionId)

// 3. Match turns to JSONL (existing logic)
const matchedTurns = matchTurnsToMessages(turns, rawMessages, toolCalls)

// 4. Get per-model usage from cost stream
const modelUsage = getModelUsageForSession(costStreamDbPath, sessionId)

// 5. Enrich turns with model-level cost data
const enrichedTurns = enrichTurnsWithCostData(matchedTurns, modelUsage)

// 6. Use ground-truth total cost when available
const pricing = costData
  ? { totalCost: costData.total_cost_usd, ...estimatedPricing }
  : calculateSessionCost(session, enrichedTurns)
```

### Priority Rules for Cost Data

1. **Cost stream (stdin)**: Ground-truth USD amounts from Claude Code API
2. **Estimation (pricing.ts)**: Fallback when cost stream is unavailable

The extractor should always attempt the cost stream first, falling back to estimation. This means:
- For ongoing sessions (real-time): cost stream is available
- For historical sessions (replayed from JSONL): cost stream may be available if stdin was captured, otherwise estimation is used

## New TypeScript Types

Add to `extractor/src/types.ts`:

```typescript
/** Cost snapshot from stdin stream */
export interface CostSnapshot {
  sessionId: string
  timestamp: string
  totalCostUsd: number
  inputCostUsd: number
  outputCostUsd: number
  cacheReadCostUsd: number
  cacheCreationCostUsd: number
}

/** Per-model usage breakdown from stdin stream */
export interface ModelUsageSnapshot {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

/** Aggregated cost summary for a session */
export interface SessionCostSummary {
  sessionId: string
  totalCostUsd: number
  inputCostUsd: number
  outputCostUsd: number
  cacheReadCostUsd: number
  cacheCreationCostUsd: number
  snapshotCount: number
  firstSnapshotAt: string
  lastSnapshotAt: string
}

/** Enriched session metadata with ground-truth cost */
export interface EnrichedSessionMetadata extends SessionMetadata {
  /** Ground-truth total cost from stdin stream (if available) */
  actualTotalCostUsd?: number
  /** Per-model usage breakdown from stdin stream */
  modelUsage?: ModelUsageSnapshot[]
}
```

## Files to Create

| File | Purpose |
|------|---------|
| `extractor/src/cost-stream-db.ts` | SQLite CRUD for cost-stream.db (create schema, insert snapshots, query summaries) |
| `extractor/src/cost-stream-capture.ts` | Stdin JSON parser + batch capture logic |
| `extractor/src/cost-stream-merger.ts` | Merge cost-stream data into FullTimelineSession |

## Migration from Estimated to Actual Costs

The `SessionPricing` type currently computes all costs from token counts. With cost-stream data:

```typescript
export interface SessionPricing {
  /** Ground-truth total cost from API (when available) */
  totalCostUsd: number
  /** Estimated cost from token counts × pricing rates (fallback) */
  estimatedCost: number
  /** Which source was used */
  costSource: "api" | "estimated"
  /** Per-turn pricing (always estimated — API doesn't send per-turn) */
  turnsPricing: TurnPricing[]
  pricingRate: PricingRate
}
```

This is a **breaking change** to `SessionPricing.totalCost` → `SessionPricing.totalCostUsd`. The web frontend would need to reference `costSource === "api" ? totalCostUsd : estimatedCost`.

## Considerations

### Storage Volume
- ~3 snapshots/second × 60 minutes = ~10,800 rows/hour
- Each row is small (~200 bytes). One hour ≈ 2MB. Acceptable.
- For sessions > 1 hour, consider downsampling (keep 1 snapshot/10s).

### Deduplication
- Stdin messages may be duplicated (replayed, re-read)
- Use `session_id + timestamp` as a dedup key
- Use `INSERT OR IGNORE` or check before insert

### Offline/No-Stdin Fallback
- When no stdin is captured (historical sessions), the extractor falls back to `pricing.ts` estimation
- The `costSource` field makes this explicit

### Raw JSON Preservation
- Store `raw_json` in `cost_snapshots` for debugging
- Helps if Claude Code changes its format in future versions
