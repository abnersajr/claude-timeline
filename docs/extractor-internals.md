# Extractor Internals — Complete Reference

> **Read this before modifying any `extractor/src/*.ts` file.**
> Every bug we've fixed is documented here with the invariant it established.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Data Sources                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ usage.db      │  │ *.jsonl      │  │ cost-stream.db        │  │
│  │ (SQLite)      │  │ (JSONL files)│  │ (live cost capture)   │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘  │
└─────────┼─────────────────┼──────────────────────┼──────────────┘
          │                 │                      │
          ▼                 ▼                      ▼
┌─────────────────┐ ┌──────────────────┐ ┌────────────────────┐
│ db-reader.ts    │ │ jsonl-parser.ts  │ │ cost-stream-*.ts   │
│ getSession()    │ │ parseSessionJsonl│ │ CostStreamDb       │
│ getTurns()      │ │   ├─ classify    │ │ getCostEnrichment()│
│ listSessions()  │ │   ├─ filter      │ └────────┬───────────┘
│ listJsonlSess() │ │   ├─ extract     │          │
│ parseJsonlSumm()│ │   └─ dedup      │          │
└────────┬────────┘ └────────┬─────────┘          │
         │                  │                     │
         ▼                  ▼                     ▼
┌──────────────────────────────────────────────────────────────┐
│ merger.ts                                                     │
│ ┌─────────────────┐ ┌──────────────────┐ ┌────────────────┐  │
│ │extractFullTime-  │ │extractJsonlTime- │ │cost-stream-    │  │
│ │line() [SQLite+J] │ │line() [JSONL     │ │merger.ts       │  │
│ │                  │ │ only]            │ │enrichTimeline- │  │
│ └─────────────────┘ └──────────────────┘ │WithCostStream()│  │
│                                          └────────────────┘  │
└──────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────┐
│ FullTimelineSession output                                    │
│ { session, turns[], pricing, contextStats, subagents,        │
│   conversationGroups }                                        │
└──────────────────────────────────────────────────────────────┘
```

## File-by-File Reference

### types.ts — Shared Interfaces

All shared types live here. Key types:

- `RawJsonlRecord` — Raw JSONL entry with `type`, `message`, `requestId`, `isMeta`, `isSidechain`, etc.
- `TokenUsage` — Per-turn token counts (input, output, cacheRead, cacheCreation5m, cacheCreation1h)
- `Turn` — Single API call record with tokens, messages, tool calls, cache info
- `SessionMetadata` — Session-level info (model, timestamps, turn count, total tokens)
- `PricingRate` — Per-model pricing config (input, output, cache read, cache write rates)
- `TurnPricing` — Per-turn cost breakdown (5 cost components)
- `SessionPricing` — Dual-stream pricing (estimated from JSONL + API from cost-stream.db)
- `FullTimelineSession` — Final output shape with everything

### classifier.ts — Message Classification

**5-category cascade** (priority order):

1. **`hardNoise`** — Filtered out entirely. Includes:
   - NOISE_TYPES: `system`, `summary`, `file-history-snapshot`, `queue-operation`, `attachment`, `last-prompt`, `permission-mode`, `ai-title`
   - Sidechain messages (`isSidechain === true`)
   - Synthetic assistant (`model === "<synthetic>"`)
   - User messages with hard noise tags (`<local-command-caveat>`, `<system-reminder>`)
   - Interruption messages (`"[Request interrupted by user]"`)

2. **`compact`** — `isCompactSummary === true`

3. **`system`** — User messages with command output tags (`<local-command-stdout>`, `<local-command-stderr>`)

4. **`user`** — `type=user`, NOT meta, has text/image content (not just tool_result blocks)
   - **Critical**: `isToolResultOnly()` check excludes array content that's ALL `tool_result` blocks. These are CLI tool outputs, not user input.

5. **`assistant`** — Everything else (catch-all). Includes meta user messages (tool results).

> **Invariant**: The classifier is the SINGLE SOURCE OF TRUTH for record categorization.
> Every pipeline stage that needs to know "is this a user message?" must call `classifyMessage()`.
> Never check `record.type === "user"` directly — that misses the tool-result-only exclusion.

### noise-filter.ts — Display Filtering

Separate from classifier. `isDisplayableEntry()` controls what gets SHOWN in the UI.
Has its own NOISE_TYPES set (slightly different from classifier — missing `ai-title`).
Used by the frontend, not by the extraction pipeline.

> **Invariant**: `noise-filter.ts` and `classifier.ts` have SEPARATE NOISE_TYPES sets.
> If you add a new noise type, add it to BOTH.

### dedup.ts — Request Deduplication

**Purpose**: Claude Code writes multiple JSONL entries per API response during streaming:
- **Streaming duplicates**: Same `requestId` with incrementally increasing `output_tokens`
- **Content blocks**: Same `requestId` with identical `output_tokens` (thinking/text/tool_use)

**Strategy**:
1. Streaming duplicates (strictly increasing tokens) → keep only the LAST entry
2. Content blocks (equal tokens) → MERGE into one record by concatenating content arrays

**How it works**:
1. Iterate records, group by `requestId`
2. If `output_tokens > previous` → streaming continuation, replace
3. If `output_tokens === previous` → different content blocks, merge content arrays
4. If `output_tokens < previous` → earlier streaming entry, ignore
5. Emit merged record at FIRST occurrence index, skip all other indices for that requestId

> **Invariant**: After dedup, each `requestId` appears exactly ONCE in the output.
> The merged record contains ALL content blocks (thinking + text + tool_use) from that response.
> Token usage is from ONE record (they're all identical across content blocks).

**Critical bug history**:
- Original dedup used `>` (strict) to find best entry, keeping only thinking blocks and dropping text/tool_use
- Fix: Only dedup on strict increase. Equal tokens = different content blocks, keep all
- Later regression: Keeping all equal-token records created duplicate turns (3× token inflation)
- Fix: Merge equal-token records into ONE record with concatenated content arrays

**Test file**: `dedup.test.ts` (7 tests covering streaming, content blocks, merge, mixed)

### jsonl-parser.ts — JSONL File Parsing

`parseSessionJsonl(path, sessionId)`:
1. Read file, split by newlines
2. For each line: parse JSON, classify, filter hardNoise
3. Normalize cache creation breakdown (`cache_creation.ephemeral_5m_input_tokens` → `cacheCreation5mTokens`)
4. Extract tool calls from assistant messages
5. Extract tool results from meta user messages
6. Link tool results to tool calls by `toolUseId`
7. Match `toolUseResult` to tool calls via `parentUuid`
8. **Deduplicate** via `deduplicateByRequestId()`
9. Return `{ rawMessages, categories, toolCalls, malformedCount }`

> **Invariant**: `rawMessages` is already deduped. Every downstream consumer
> (`buildTurnsFromJsonl`, `extractJsonlTimeline` token summing, `parseJsonlSummary`)
> receives deduped data. Token summing from `rawMessages` is safe because each
> `requestId` appears exactly once.

### tool-extraction.ts — Tool Call/Result Extraction

- `extractToolCalls(content, timestamp)` — Extracts `tool_use` blocks from assistant content arrays. Identifies Task tools specially.
- `extractToolResults(content)` — Extracts `tool_result` blocks from user content arrays.
- `linkToolResults(calls, results)` — Links results to calls by `toolUseId`. Returns new array (no mutation).
- `formatToolResult(content)` — Formats result content to string (stdout/stderr, questions/answers, generic JSON).

> **Critical field access pattern**: Both `tool_use_id` and `toolUseId` must be checked:
> ```typescript
> toolUseId: String(block.tool_use_id ?? block.toolUseId ?? "")
> isError: (block.is_error ?? block.isError) as boolean | undefined
> ```
> Raw JSONL uses snake_case. Processed data uses camelCase. Always check both.

### tool-matcher.ts — Tool Execution Matching

- `collectToolCalls(rawMessages)` — Collects all tool_use blocks from assistant messages
- `matchToolCalls(toolCalls, toolResults)` — Matches by toolUseId, computes timing
- `buildToolResultMap(rawMessages)` — Builds result map from toolUseResult metadata

### model-parser.ts — Model Name Normalization

`parseModelName(raw)` / `normalizeModelName(raw)`:
- Strips provider prefix (`anthropic/`)
- Strips date suffix (`-20250514`)
- Lowercases
- Returns `"unknown"` for null/undefined/empty

Examples:
- `"anthropic/claude-sonnet-4-20250514"` → `"claude-sonnet-4"`
- `"claude-opus-4-20250514"` → `"claude-opus-4"`
- `"claude-sonnet-4-6"` → `"claude-sonnet-4-6"`

### pricing.ts — Cost Calculation

**PRICING_TABLE**: Maps normalized model names to pricing rates.

| Model | Input | Output | Cache Read | Cache Write 5m | Cache Write 1h |
|---|---|---|---|---|---|
| claude-opus-4-7/4-6/4-5 | $5.00 | $25.00 | $0.50 | $6.25 | $10.00 |
| claude-opus-4-1/4 | $15.00 | $75.00 | $1.50 | $18.75 | $30.00 |
| claude-sonnet-4-6/4-5/4/3-7 | $3.00 | $15.00 | $0.30 | $3.75 | $6.00 |
| claude-haiku-4-5 | $1.00 | $5.00 | $0.10 | $1.25 | $2.00 |
| claude-haiku-3-5 | $0.80 | $4.00 | $0.08 | $1.00 | $1.60 |
| claude-haiku-3 | $0.25 | $1.25 | $0.03 | $0.30 | $0.50 |

**Cache multiplier pattern**: 5m write = 1.25× input, 1h write = 2× input, cache read = 0.1× input.

`getPricing(modelName)`:
- Normalizes model name internally
- Falls back to `claude-sonnet-4-6` rates for unknown models (with console.warn)

`calculateTurnCost(turn, sessionRate)`:
- Uses turn-level model when available (`turn.model`), otherwise session default
- Computes 5 cost components: input, output, cacheRead, cacheCreation5m, cacheCreation1h

`calculateSessionCost(session, turns)`:
- Gets session-level rate
- Maps each turn through `calculateTurnCost`
- Returns `SessionPricing` with estimated stream populated

> **Invariant**: Missing models in PRICING_TABLE cause silent cost inflation (Sonnet fallback).
> Always verify new models are in the table. Check with `claude /usage` for validation.

### merger.ts — Core Pipeline

#### Two entry points

**`extractFullTimeline(sessionId, dbPath, projectsDir)`** — SQLite + JSONL merge:

1. `getSession(dbPath, sessionId)` — Get session metadata from SQLite
2. `getTurns(dbPath, sessionId)` — Get turns from SQLite (token data, timestamps)
3. `resolveSessionJsonlPath(session, projectsDir)` — Find JSONL file
4. `parseSessionJsonl(jsonlPath, sessionId)` — Parse JSONL (deduped)
5. `matchTurnsToMessages(turns, rawMessages, toolCalls)` — Match SQLite turns to JSONL messages
6. `inferCacheReadType()` — Enrich turns with cache read type
7. `calculateSessionCost(session, turns)` — Compute pricing
8. `computeContextStats(rawMessages)` — Context tracking
9. `extractCommandExecuted(rawMessages)` — Extract slash command
10. `detectSessionState(rawMessages)` — Ongoing vs completed
11. `listSubagentFiles()` + `resolveSubagents()` — Subagent discovery
12. `buildConversationGroups(enrichedTurns)` — Group turns
13. `computeActiveDurationMs(enrichedTurns)` — Active time

**`extractJsonlTimeline(sessionId, projectsDir, jsonlPath)`** — JSONL only (no SQLite):

Used when session isn't in SQLite (ongoing sessions, un-flushed data).

1. `parseSessionJsonl(jsonlPath, sessionId)` — Parse and dedup
2. `detectSessionState(rawMessages)` — Ongoing detection
3. Extract model from first assistant message
4. Count user messages for turn count
5. **Sum token totals from rawMessages** — iterates ALL deduped records
6. `buildTurnsFromJsonl(rawMessages, toolCalls)` — Build synthetic turns
7. `inferCacheReadType()` — Cache read enrichment
8. Derive startTime/endTime from meaningful turns
9. `calculateSessionCost(session, turns)` — Pricing
10. `computeContextStats(rawMessages)` — Context tracking
11. Subagent resolution, conversation groups, active duration

> **Invariant**: Token summing (step 5) is safe because `rawMessages` is already deduped.
> Each `requestId` appears exactly once, so tokens are counted once per API response.

#### `matchTurnsToMessages(turns, messages, toolCalls)` — SQLite↔JSONL matching

Two-pass matching strategy:
- **Pass 1**: User text records within 10s window (priority)
- **Pass 2**: Other records (assistant, tool_result) within 5s window
- **Fallback**: Index-based matching for unmatched records

Each message matched to at most ONE turn (closest timestamp wins).
Tool calls assigned to closest turn via `toolCallsByTurnIdx` (one-to-one).

Unmatched user text records → synthetic turns (zero tokens, inserted chronologically).

#### `buildTurnsFromJsonl(rawMessages, toolCalls)` — JSONL-only turn building

Creates turns from deduped JSONL records. For each classified assistant/user record:
1. Match tool calls to closest turn (one-to-one, 5s window)
2. Skip zero-token noise (no tools, no meaningful content)
3. Extract cache creation tokens
4. Build Turn object

> **Invariant**: Each record becomes exactly ONE turn. No duplication because
> `rawMessages` is already deduped by `deduplicateByRequestId`.

#### `normalizeContent(content)` — Content block normalization

Converts raw JSONL content to `MessageContent[]`:
- String → `[{ type: "text", text: content }]`
- Array → filters thinking blocks, maps text/tool_use/tool_result
- **Snake_case AND camelCase** field access for tool_result:
  ```typescript
  toolUseId: String(block.tool_use_id ?? block.toolUseId ?? "")
  isError: (block.is_error ?? block.isError) as boolean | undefined
  ```

> **Invariant**: Thinking blocks are FILTERED OUT in `normalizeContent`.
> They're internal model reasoning, not user-facing content.

### db-reader.ts — SQLite + JSONL Discovery

`listSessions(dbPath)` — Reads from SQLite, computes cost via `calculateSessionCost`.

`listJsonlSessions(projectsDir, dbPath)` — Scans JSONL files, skips SQLite sessions.
Uses `parseJsonlSummary()` which runs the same pipeline as `parseSessionJsonl`:
classify → filter hardNoise → dedup → count/sum.

`parseJsonlSummary(filePath, sessionId, projectName)` — Lightweight JSONL header parser.
Same dedup pipeline as `parseSessionJsonl`: classify, filter, deduplicateByRequestId.
Token summing iterates deduped records (safe).

### conversation-groups.ts — Turn Grouping

`buildConversationGroups(turns)`:
- Scans turns in order
- User message starts new group
- AI-only turns appended to current group
- Orphaned AI turns get their own group
- Token usage aggregated per group

### subagent-locator.ts — Subagent File Discovery

`listSubagentFiles(projectsDir, projectName, sessionId)`:
- NEW nested: `{project}/{session}/subagents/agent-{id}.jsonl`
- Legacy flat: `{project}/agent-{id}.jsonl` (filtered by sessionId)
- Skips compact agents (`acompact*`)

### subagent-resolver.ts — Subagent Resolution

`resolveSubagents(subagentFiles, parentToolCalls)`:
- 3-phase linking: agentId → description → positional fallback
- Detects parallel execution (100ms overlap window)
- Aggregates tokens with request-id dedup
- Parses subagent JSONL with same dedup pipeline

### session-state.ts — Ongoing Detection

`detectSessionState(records)`:
- Classifies each record into activity type
- Finds last ending event (text_output or interruption)
- Checks if AI activities exist after last ending event
- If yes → ongoing, if no → completed

### context-tracker.ts — Context Statistics

`computeContextStats(records)`:
- Categorizes each record: user-message, tool-output, thinking-text, system, compact, other
- Detects compaction phases (bounded by `isCompactSummary` events)
- Tracks `input_tokens` per category per phase

### cost-stream-*.ts — Live Cost Capture

**cost-stream-db.ts**: SQLite CRUD for `cost-stream.db` (separate from `usage.db`)
- Schema: `cost_snapshots` + `session_cost_summary`
- WAL mode, foreign keys

**cost-stream-capture.ts**: Stdin JSON parser for real-time/batch cost capture
- Parses Claude Code's stdin JSON (`cost.total_cost_usd`, usage tokens, model)
- Writes to `cost-stream.db`

**cost-stream-merger.ts**: Merges cost-stream data into extraction pipeline
- `enrichTimelineWithCostStream(timeline, dbPath)` — Adds API cost stream to SessionPricing
- Dual-stream: estimated (JSONL × rates) always available, API (cost-stream.db) when available
- `totalCost` prefers API when available

---

## Critical Invariants (DO NOT VIOLATE)

### 1. Dedup Before Token Summing

**Rule**: Never sum tokens from non-deduped records.
**Why**: Each API response writes 2-4 JSONL entries (thinking/text/tool_use) with identical tokens. Without dedup, tokens are counted 2-4× per response.
**Where**: `parseSessionJsonl` dedupes → `rawMessages` is safe to iterate.

### 2. One Turn Per RequestId

**Rule**: Each `requestId` must produce exactly ONE turn in the output.
**Why**: Multiple content blocks (thinking/text/tool_use) from the same response are ONE API call.
**Where**: `deduplicateByRequestId` merges content blocks → `buildTurnsFromJsonl` creates one turn per record.

### 3. Classifier Is Single Source of Truth

**Rule**: Use `classifyMessage()` for all record categorization.
**Why**: Direct `record.type` checks miss the tool-result-only exclusion, meta message handling, etc.
**Where**: Every pipeline stage (parser, merger, matcher, summary).

### 4. Snake_case AND camelCase Field Access

**Rule**: When accessing JSONL content block fields, check BOTH forms.
**Why**: Raw JSONL uses `tool_use_id`/`is_error`. Processed data uses `toolUseId`/`isError`.
**Where**: `normalizeContent`, `extractToolResults`, `linkToolResults`.

### 5. Dual NOISE_TYPES Sets

**Rule**: When adding a new noise type, add to BOTH `classifier.ts` AND `noise-filter.ts`.
**Why**: Classifier filters during extraction. noise-filter filters during display. They have separate sets that can drift.

### 6. Build & Restart After Extractor Changes

**Rule**: After modifying `extractor/src/*.ts`, run `npx tsc` then restart API.
**Why**: API imports from `extractor/dist/` (compiled). Source changes don't take effect without rebuild.
**Where**: `cd extractor && npx tsc`, then `kill $(lsof -i :3099 -t) && cd api && pnpm dev`

### 7. turnsPricing Must Match turns

**Rule**: When slicing `turns` for groups, slice `turnsPricing` identically.
**Why**: Child components do `turnsPricing[i]` by local index. Full array + sliced turns = wrong pricing.
**Where**: ChatTimeline → InteractionGroup → ProcessingTurns.

### 8. buildSessionSteps on Same Turn Set

**Rule**: `buildSessionSteps()` MUST be called on the SAME set of turns in every consumer.
**Why**: Different slicing → different step counts → click-to-scroll breaks.
**Where**: PerStepTable, TokenChart, Timeline.

### 9. Cost Formatting: Single Source of Truth

**Rule**: All cost display uses `formatCost()` from `web/src/lib/utils.ts` (3 decimal places).
**Why**: User explicitly corrected inconsistent formatting.
**Where**: Every component showing costs.

### 10. No Truncation Inside Expanded Collapsibles

**Rule**: Expanded collapsible content shows FULL content (scrollable, not truncated).
**Why**: User corrected this — truncation inside expanded panels blocks reading.
**Where**: CollapsibleResult, ResultSection, ToolResultSection.

---

## Token Semantics

`input_tokens` is NOT the total input. It's the non-cached delta (1-2 tokens typically).

| Field | Meaning |
|---|---|
| `input_tokens` | New tokens beyond cache (1-2 typically) |
| `cache_read_input_tokens` | Context reused from cache (bulk) |
| `cache_creation_input_tokens` | New context written to cache |
| `output_tokens` | Model's response tokens |

**Total context processed**: `inputTokens + cacheReadTokens + cacheCreation5mTokens + cacheCreation1hTokens`

Display as "Context" in UI, not "Input".

---

## Claude Code JSONL Format

Each API response writes multiple entries:

```
requestId: req_011Cax...
  → type=assistant, content=[{type:"thinking"}], output_tokens=676
  → type=assistant, content=[{type:"text"}],     output_tokens=676
  → type=assistant, content=[{type:"tool_use"}], output_tokens=676
```

All share the same `requestId` and `output_tokens`. They're different content
blocks from ONE API response, NOT duplicates.

User messages have 3 subtypes:
1. User-typed text (`isMeta=null`, string content)
2. Tool result only (`isMeta=null`, array of `tool_result` blocks — NOT user input)
3. Meta user (`isMeta=true`, system-injected context)

---

## `/usage` vs Extractor Cost Discrepancy

`/usage` reads from Claude Code's IN-MEMORY state (authoritative, complete).
Extractor reads from JSONL (async log, may be incomplete).

Data flow:
```
Anthropic API → Claude Code runtime (in-memory) → /usage reads this
                  ↓ (async, fire-and-forget)
                JSONL file → extractor reads this
                  ↓ (async, may lag)
                usage.db → listSessions reads this
```

Cost discrepancies are a **data availability limitation**, not a calculation bug.

---

## Test Coverage

| Module | Test File | Tests |
|---|---|---|
| classifier | classifier.test.ts | 24 |
| dedup | dedup.test.ts | 7 |
| tool-extraction | tool-extraction.test.ts | 18 |
| conversation-groups | conversation-groups.test.ts | ~10 |
| session-state | session-state.test.ts | ~8 |
| context-tracker | context-tracker.test.ts | ~10 |
| subagent-resolver | subagent-resolver.test.ts | ~15 |
| subagent-locator | subagent-locator.test.ts | ~8 |
| model-parser | model-parser.test.ts | ~10 |
| pricing | pricing.test.ts | ~15 |
| integration | integration.test.ts | ~5 |

**Total**: ~300 tests. Run with `cd extractor && npx vitest run`.
