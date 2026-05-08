# Claude Code Session Extractor — Implementation-Ready Spec

**Date**: 2026-05-08  
**Status**: Approved by User (Sections 1–4), Addressing Spec Review Iter 4  
**Phase**: 1 — Standalone TypeScript Data Extractor  

---

## 1. Functional Requirements

### 1.1 Success Criteria (Happy Path)
- Given a valid `session_id`, extractor produces valid JSON matching `FullTimelineSession` schema
- SQLite `usage.db` is read for session metadata + turn token counts
- JSONL `session.jsonl` is parsed for messages + tool calls + cache creation breakdown
- Cache tier tracking: 5m vs 1h writes (from JSONL), reads (inferred, UI-only)
- Pricing calculated using hardcoded model rates (fallback to Sonnet 4.6 for unknown models)
- Output: Pretty-printed JSON to stdout or `--output` file

### 1.2 Failure Modes (Error Handling)
| Error | Severity | Action | Exit Code |
|-------|----------|--------|----------|
| Missing `--session-id` | Fatal | Print usage + exit | 1 |
| Session not in SQLite | Fatal | Throw error with tip | 2 |
| SQLite DB open failure | Fatal | Throw error with permissions tip | 3 |
| JSONL file not found | Warning | Continue with empty messages | 0 |
| Malformed JSONL lines | Warning | Skip line, count skipped | 0 |
| Cache breakdown missing | Warning | Fallback to 5m assumption | 0 |
| Unknown model | Warning | Use fallback pricing | 0 |
| Output write failure | Warning | Fallback to stdout | 0 |

### 1.3 Non-Goals (YAGNI)
- No streaming parser in Phase 1 (see `streaming-parser-plan.md` for future)
- No multi-session support in Phase 1 (single session only)
- No external API calls for pricing (hardcoded table only)

---

## 2. Module Interface Contracts

### 2.1 `types.ts`
Defines core interfaces (see `2026-05-08-session-extractor-types.md` for full details):
- `TokenUsage`, `Turn`, `Message`, `ToolCall`, `SessionMetadata`
- `PricingRate`, `TurnPricing`, `SessionPricing`, `FullTimelineSession`
- `RawJsonlRecord` (internal, not exported)

### 2.2 `db-reader.ts`
```typescript
// Custom error classes for typed error handling
class DbOpenError extends Error { code = 3; constructor(message: string) { super(message); } }
class SessionNotFoundError extends Error { code = 2; constructor(sessionId: string) { super(`Session not found: ${sessionId}`); } }

// Throws DbOpenError on DB open failure, SessionNotFoundError if not found
function getSession(dbPath: string, sessionId: string): SessionMetadata
// Returns empty array if no turns found (valid case)
function getTurns(dbPath: string, sessionId: string): Turn[]
// Returns model from first turn (ORDER BY timestamp ASC LIMIT 1)
function getModelForSession(dbPath: string, sessionId: string): string
```

### 2.3 `jsonl-parser.ts`
```typescript
// Returns null if file not found (caller handles)
// Throws on critical I/O errors
function parseSessionJsonl(jsonlPath: string | null, sessionId: string): {
  rawMessages: RawJsonlRecord[];  // Unnormalized
  toolCalls: ToolCall[];           // Extracted tool calls
  malformedCount: number;        // For diagnostics
} | null
```

### 2.4 `merger.ts`
```typescript
// Main orchestrator
function extractFullTimeline(
  sessionId: string,
  dbPath: string,
  projectsDir: string
): FullTimelineSession {
  // 1. Get session + turns from SQLite
  // 2. Find JSONL path via resolveSessionJsonlPath() (handle null)
  // 3. Parse JSONL (handle null → empty messages)
  // 4. Match turns ↔ rawMessages (deterministic algorithm)
  // 5. Normalize RawJsonlRecord → Message
  // 6. Infer cacheReadType per turn
  // 7. Calculate pricing
  // 8. Return FullTimelineSession
}

// JSONL path resolution (explicit contract):
// Returns null if not found (caller handles)
function resolveSessionJsonlPath(
  session: SessionMetadata,
  projectsDir: string
): string | null {
  // 1. Primary: projectName with "/" → "-" (e.g., "/Users/foo" → "-Users-foo")
  // 2. Fallback: URL-encoded version (encodeURIComponent)
  // 3. Returns null if neither found
}

// Turn matching algorithm (deterministic):
// 1. Primary: Find rawMsg with |turn.timestamp - rawMsg.timestamp| < 5s
//    - If exactly ONE match → use it
//    - If MULTIPLE matches → use uuid match (if turn has uuid)
//    - If NO uuid match among multiples → use FIRST match (lowest index)
// 2. Fallback: turn[i] → rawMessages[i] (assumes both ordered by time)
// 3. Unmatched turns/messages → log warning with counts
```

### 2.4.1 Cache Read Type Inference (Reproducible Algorithm)
```typescript
// NOTE: cacheReadType is for UI display ONLY (not for billing).
// Pricing uses cacheReadPerMTok (same rate for both tiers).
// This algorithm is NOT definitive — see CONTRIBUTING.md > Key Assumptions.

function inferCacheReadType(
  turnIndex: number,
  turns: Turn[],
  currentTurnTime: string
): '5m' | '1h' | '5m-fallback' | 'unknown' {
  try {
    const currentTime = new Date(currentTurnTime).getTime();
    if (isNaN(currentTime)) return 'unknown';
    
    const prevTurn = turns[turnIndex - 1];
    if (!prevTurn) return '5m-fallback'; // No previous turn → assume 5m default
    
    const prevTime = new Date(prevTurn.timestamp).getTime();
    if (isNaN(prevTime)) return 'unknown';
    
    const timeDiff = currentTime - prevTime;
    
    // If previous turn wrote to 1h cache, check if within 1 hour
    if (prevTurn.cacheWriteType === '1h' && timeDiff < 60 * 60 * 1000) {
      return '1h';
    }
    // If previous turn wrote to 5m cache, check if within 5 minutes
    if (prevTurn.cacheWriteType === '5m' && timeDiff < 5 * 60 * 1000) {
      return '5m';
    }
    
    return '5m-fallback'; // Default assumption (Anthropic's default TTL)
  } catch (err) {
    return 'unknown'; // Only on actual parse errors
  }
}
```

### 2.5 `pricing.ts`
```typescript
// Returns fallback (Sonnet 4.6) for unknown models (logs warning)
function getPricing(modelName: string): PricingRate
// cacheReadType is UI-only (pricing same for both tiers)
function calculateSessionCost(session: SessionMetadata, turns: Turn[]): SessionPricing
```

### 2.6 `index.ts`
```typescript
// Exit codes: 0=success, 1=usage error, 2=DB error, 3=permissions
function parseArgs(argv: string[]): Config | never
function outputJSON(data: FullTimelineSession, outputPath: string | null): void
```

### 2.7 `utils.ts`
```typescript
// CLaude_CONFIG_DIR env var support:
// - If set: dbPath = `${CLAUDE_CONFIG_DIR}/usage.db`
// - If set: projectsDir = `${CLAUDE_CONFIG_DIR}/projects`
// - Default: ~/.claude/usage.db and ~/.claude/projects
function getDbPath(customPath?: string): string
function getProjectsDir(customPath?: string): string
// Project name encoding: replace "/" with "-"
// Fallback: try URL-encoded version if "-" version not found
function encodeProjectName(projectName: string): string
```

---

## 3. Merge Policy Table

| Rule | Behavior |
|------|----------|
| Turn ordering | SQLite turns ORDER BY timestamp ASC |
| Message matching | Primary: ±5s timestamp window; Secondary: uuid match; Fallback: index-based |
| Unmatched turns | Keep turn with empty messages, log warning |
| Unmatched messages | Attach to nearest turn by timestamp, log warning |
| Token counts | SQLite is authoritative (billed amounts) |
| Cache creation breakdown | JSONL is authoritative (has 5m/1h breakdown) |
| Cache read type | Inferred from previous turn (UI-only, not for billing) |
| Pricing | Hardcoded table, fallback to Sonnet 4.6, log warning |

---

## 4. CLI Specification

### 4.1 Flags
```
--session-id <id>    (required) Session UUID to extract
--db-path <path>       SQLite DB path (default: ~/.claude/usage.db)
--projects-dir <path>  Projects directory (default: ~/.claude/projects)
--output <path>         Write JSON to file instead of stdout
```

### 4.2 Exit Codes
| Code | Meaning |
|------|---------|
| 0 | Success (may have warnings) |
| 1 | Missing required arguments (--session-id) |
| 2 | Session not found in SQLite |
| 3 | SQLite DB open failure (permissions, corrupt) |

### 4.3 Output Format
- Default: Pretty-printed JSON to stdout
- `--output`: Write to file, fallback to stdout on write failure
- Machine-readable errors to stderr

---

## 5. Test Matrix (for Implementation)

### 5.1 Unit Tests
| Module | Test Case |
|--------|-----------|
| `db-reader.ts` | Valid session → returns SessionMetadata |
| `db-reader.ts` | Session not found → throws with exit code 2 |
| `db-reader.ts` | DB open failure → throws with exit code 3 |
| `jsonl-parser.ts` | Valid JSONL → returns rawMessages + toolCalls |
| `jsonl-parser.ts` | File not found → returns null |
| `jsonl-parser.ts` | Malformed lines → skips, increments malformedCount |
| `merger.ts` | Turn ↔ message matching (timestamp, uuid, index fallback) |
| `merger.ts` | Cache creation breakdown extraction (5m vs 1h) |
| `merger.ts` | Cache read type inference |
| `pricing.ts` | Known model → correct rates |
| `pricing.ts` | Unknown model → fallback + warning |
| `utils.ts` | Path resolution (CLAUDE_CONFIG_DIR, defaults) |
| `utils.ts` | Project name encoding ("/" → "-") |

### 5.2 Integration Tests
| Scenario | Expected Result |
|----------|----------------|
| Full happy path | Valid JSON output matching FullTimelineSession schema |
| Missing JSONL | JSON output with empty messages, warning logged |
| Unknown model | JSON output with fallback pricing, warning logged |
| CLI --output failure | Output falls back to stdout, warning logged |

### 5.3 CLI Boundary Test (Schema Validation)
| Test Case | Command | Expected Result |
|-----------|---------|----------------|
| Valid session | `tsx src/index.ts --session-id <valid>` | Exit 0, stdout = valid FullTimelineSession JSON |
| Invalid session | `tsx src/index.ts --session-id <invalid>` | Exit 2, stderr = error message |
| Missing arg | `tsx src/index.ts` | Exit 1, stderr = usage help |
| Output file | `tsx src/index.ts --session-id <valid> --output out.json` | Exit 0, out.json = valid JSON |
| Output dir missing | `tsx src/index.ts --session-id <valid> --output /nonexist/out.json` | Exit 0, fallback to stdout, stderr = warning |

---

## 6. Key Decisions Summary

1. **Modular architecture** (Approach 2) — clear boundaries, testable units
2. **SQLite authoritative for tokens**, JSONL for cache breakdown
3. **Cache read type is inferred** (not definitive) — UI-only display
4. **Pricing hardcoded** — no external API calls
5. **Single session only** in Phase 1 — multi-session is future
6. **Streaming parser is future** — see `streaming-parser-plan.md`

---

## 7. References

- Full TypeScript interfaces: `2026-05-08-session-extractor-types.md`
- Data flow & error handling: `2026-05-08-session-extractor-dataflow.md`
- Assumptions & caveats: `2026-05-08-session-extractor-appendix.md`
- Streaming parser plan: `streaming-parser-plan.md`
- Session report (data schemas): `session-report.md`

---

**End of Implementation-Ready Spec**
