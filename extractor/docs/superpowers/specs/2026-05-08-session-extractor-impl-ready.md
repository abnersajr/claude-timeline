# Claude Code Session Extractor — Implementation-Ready Spec

**Date**: 2026-05-08  
**Updated**: 2026-05-09 — Incorporated claude-devtools analysis (streaming, noise filtering, subagent resolution, tool matching)  
**Status**: Approved by User  
**Phase**: 1 — Standalone TypeScript Data Extractor  

---

## 1. Functional Requirements

### 1.1 Success Criteria (Happy Path)
- Given a valid `session_id`, extractor produces valid JSON matching `FullTimelineSession` schema
- SQLite `usage.db` is read for session metadata + turn token counts
- JSONL `session.jsonl` is parsed via **streaming readline** (not fs.readFileSync)
- **RequestId deduplication**: Only last entry per requestId kept (streaming artifact)
- **Noise filtering**: Skip system/summary/synthetic/hard-noise messages
- **sourceToolUseID matching**: Tool calls matched to results via sourceToolUseID (primary)
- **Subagent resolution**: Handle both NEW and OLD subagent directory structures
- **Conversation grouping**: Group user message + AI responses
- **Context consumption tracking**: Track tokens across compaction phases
- **Ongoing session detection**: Mark sessions as in-progress vs completed
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
| Subagent file parse error | Warning | Skip subagent, continue | 0 |
| Warmup subagent | Info | Skip (not a real subagent) | 0 |

### 1.3 Non-Goals (YAGNI)
- No multi-session support in Phase 1 (single session only)
- No external API calls for pricing (hardcoded table only)
- No UI rendering (data extraction only)

---

## 2. Module Interface Contracts

### 2.1 `types.ts`
Defines complete interfaces (see `2026-05-08-session-extractor-types.md` for full details):
- `TokenUsage`, `ParsedMessage`, `ToolCall`, `ToolResult`, `ToolExecution`
- `Turn`, `ConversationGroup`, `TaskExecution`, `Subagent`
- `SessionMetadata`, `PhaseTokenBreakdown`
- `PricingRate`, `TurnPricing`, `SessionPricing`, `FullTimelineSession`

### 2.2 `db-reader.ts`
```typescript
class DbOpenError extends Error { code = 3; }
class SessionNotFoundError extends Error { code = 2; }

function getSession(dbPath: string, sessionId: string): SessionMetadata
function getTurns(dbPath: string, sessionId: string): Turn[]
function getModelForSession(dbPath: string, sessionId: string): string
```

### 2.3 `noise-filter.ts`
```typescript
function isDisplayableEntry(entry: RawJsonlEntry): boolean
function classifyMessage(msg: ParsedMessage): MessageCategory
```

### 2.4 `jsonl-parser.ts`
```typescript
// Streaming readline by default (not fs.readFileSync)
async function parseSessionJsonl(jsonlPath: string): ParsedMessage[]
function deduplicateByRequestId(messages: ParsedMessage[]): ParsedMessage[]
```

### 2.5 `tool-matcher.ts`
```typescript
// Uses sourceToolUseID as primary matching (not timestamp)
function buildToolExecutions(messages: ParsedMessage[]): ToolExecution[]
```

### 2.6 `subagent-resolver.ts`
```typescript
// Handles both NEW and OLD subagent directory structures
async function discoverSubagentFiles(projectsDir: string, sessionId: string): Promise<string[]>
async function resolveSubagents(
  projectsDir: string, sessionId: string,
  taskCalls: ToolCall[], messages: ParsedMessage[]
): Promise<Subagent[]>
```

### 2.7 `merger.ts`
```typescript
// Main orchestrator
function extractFullTimeline(sessionId: string, dbPath: string, projectsDir: string): FullTimelineSession

// Helpers (exported for testing)
function buildConversationGroups(messages: ParsedMessage[], subagents: Subagent[]): ConversationGroup[]
function trackContextConsumption(messages: ParsedMessage[]): { contextConsumption: number; compactionCount: number; phaseBreakdown: PhaseTokenBreakdown[] }
function checkSessionOngoing(messages: ParsedMessage[]): boolean
function inferCacheReadType(turnIndex: number, turns: Turn[], currentTurnTime: string): '5m' | '1h' | 'unknown'
function matchTurnsToMessages(turns: Turn[], messages: ParsedMessage[]): { matchedTurns: Turn[]; unmatchedTurns: number; unmatchedMessages: number }
```

### 2.8 `pricing.ts`
```typescript
function getPricing(modelName: string): PricingRate
function calculateSessionCost(session: SessionMetadata, turns: Turn[]): SessionPricing
```

### 2.9 `index.ts`
```typescript
function parseArgs(argv: string[]): Config | never
function outputJSON(data: FullTimelineSession, outputPath: string | null): void
```

### 2.10 `utils.ts`
```typescript
function getDbPath(customPath?: string): string
function getProjectsDir(customPath?: string): string
function encodeProjectName(projectName: string): string
function resolveSessionJsonlPath(session: SessionMetadata, projectsDir: string): string | null
```

---

## 3. Merge Policy Table

| Rule | Behavior |
|------|----------|
| Turn ordering | SQLite turns ORDER BY timestamp ASC |
| Message matching | Primary: ±5s timestamp window; If multiple: use uuid match; Fallback: turn[i] → messages[i] |
| Tool call matching | Primary: sourceToolUseID; Fallback: toolResults array |
| Unmatched turns | Keep turn with empty messages, log warning |
| Unmatched messages | Attach to nearest turn, log warning |
| Token counts | SQLite is authoritative (billed amounts) |
| Cache creation breakdown | JSONL is authoritative (has 5m/1h breakdown) |
| Cache read type | Inferred from previous turn (UI-only, not for billing) |
| Pricing | Hardcoded table, fallback to Sonnet 4.6 |
| Noise filtering | Skip system/summary/synthetic/hard-noise messages |
| Subagent resolution | NEW + OLD structures, skip warmup/compact |
| Conversation grouping | User message + AI responses until next user message |
| Context consumption | Track tokens across compaction phases |
| Ongoing detection | Activity vs ending events, 5min stale threshold |

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
| `noise-filter.ts` | Filter system/summary/file-history-snapshot/queue-operation |
| `noise-filter.ts` | Filter synthetic assistant messages |
| `noise-filter.ts` | Filter sidechain messages |
| `noise-filter.ts` | Filter hard noise tags (<local-command-caveat>, <system-reminder>) |
| `noise-filter.ts` | Keep real user/assistant messages |
| `noise-filter.ts` | Keep meta user messages (tool results) |
| `jsonl-parser.ts` | Streaming parse → returns ParsedMessage[] |
| `jsonl-parser.ts` | File not found → returns empty array |
| `jsonl-parser.ts` | Malformed lines → skips, continues |
| `jsonl-parser.ts` | Dedup by requestId → keeps last entry |
| `jsonl-parser.ts` | Extract all metadata fields |
| `tool-matcher.ts` | Match via sourceToolUseID |
| `tool-matcher.ts` | Fallback to toolResults array |
| `tool-matcher.ts` | Handle calls without results |
| `subagent-resolver.ts` | Discover NEW structure files |
| `subagent-resolver.ts` | Skip warmup subagents |
| `subagent-resolver.ts` | Skip compact files |
| `subagent-resolver.ts` | Link to Task calls via agentId |
| `subagent-resolver.ts` | Detect parallel execution |
| `merger.ts` | Turn ↔ message matching |
| `merger.ts` | Cache creation breakdown extraction |
| `merger.ts` | Cache read type inference |
| `merger.ts` | Conversation grouping |
| `merger.ts` | Context consumption tracking |
| `merger.ts` | Ongoing session detection |
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

---

## 6. Key Decisions Summary

1. **Modular architecture** (Approach 2) — clear boundaries, testable units
2. **Streaming readline by default** — not fs.readFileSync
3. **RequestId deduplication** — keep only last entry per requestId
4. **Noise filtering** — skip system/summary/synthetic/hard-noise messages
5. **sourceToolUseID matching** — primary method for tool call ↔ result pairing
6. **Subagent resolution** — handle both NEW and OLD directory structures
7. **Conversation grouping** — group user message + AI responses
8. **Context consumption tracking** — track tokens across compaction phases
9. **Ongoing session detection** — mark sessions as in-progress vs completed
10. **SQLite authoritative for tokens**, JSONL for cache breakdown
11. **Cache read type is inferred** (not definitive) — UI-only display
12. **Pricing hardcoded** — no external API calls
13. **Single session only** in Phase 1 — multi-session is future

---

## 7. References

- Full TypeScript interfaces: `2026-05-08-session-extractor-types.md`
- Data flow & error handling: `2026-05-08-session-extractor-dataflow.md`
- Assumptions & caveats: `2026-05-08-session-extractor-appendix.md`
- Implementation plan: `2026-05-08-session-extractor-impl.md`
- Session report (data schemas): `session-report.md`
- claude-devtools (inspiration): https://github.com/matt1398/claude-devtools

---

**End of Implementation-Ready Spec**
