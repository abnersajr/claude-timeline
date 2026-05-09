## 1. Architecture Overview & Module Structure

### Approach: Modular Package (Approach 2)

Split into focused modules with clear interfaces. Inspired by [claude-devtools](https://github.com/matt1398/claude-devtools) architecture for parsing, noise filtering, and subagent resolution.

```
timeline/
├── src/
│   ├── types.ts              # Shared TypeScript interfaces (complete data model)
│   ├── db-reader.ts          # SQLite usage.db reading (sessions, turns)
│   ├── jsonl-parser.ts       # Streaming JSONL parser (readline, dedup, noise filter)
│   ├── noise-filter.ts       # Message classification & noise detection
│   ├── subagent-resolver.ts  # Subagent file discovery, parsing, linking
│   ├── tool-matcher.ts       # Tool call ↔ result matching via sourceToolUseID
│   ├── merger.ts             # Merge SQLite + JSONL data by session_id
│   ├── pricing.ts            # Built-in model pricing lookup table
│   ├── index.ts              # Main extractor entry point (standalone runner)
│   └── utils.ts              # Path resolution, env var handling (CLAUDE_CONFIG_DIR)
├── docs/
│   ├── streaming-parser-plan.md   # Streaming parser design (NOW DEFAULT)
│   └── superpowers/specs/         # Design docs (this file)
├── package.json
├── tsconfig.json
├── biome.json                # Biome config (no ESLint/Prettier)
├── .editorconfig
├── .gitignore
├── README.md
├── AGENTS.md
├── CLAUDE.md
└── CONTRIBUTING.md
```

### Key Design Decisions:
1. **`types.ts`** defines complete interfaces: `ParsedMessage`, `Turn`, `ToolCall`, `ToolExecution`, `Subagent`, `SessionMetadata`, `PricingRate`, `FullTimelineSession` — includes all JSONL fields (parentUuid, isSidechain, isMeta, sourceToolUseID, agentId, requestId, etc.)
2. **`db-reader.ts`** exports: `getSession(dbPath, sessionId) → SessionMetadata`, `getTurns(dbPath, sessionId) → Turn[]`
3. **`jsonl-parser.ts`** exports: `parseSessionJsonl(jsonlPath) → ParsedMessage[]` — Uses streaming `readline` by default, deduplicates by `requestId`, filters noise via `noise-filter.ts`
4. **`noise-filter.ts`** exports: `isDisplayableEntry(entry) → boolean`, `classifyMessage(msg) → MessageCategory` — Filters out `system`, `summary`, `file-history-snapshot`, `queue-operation`, synthetic messages, and hard noise tags
5. **`subagent-resolver.ts`** exports: `resolveSubagents(projectId, sessionId, taskCalls, messages) → Subagent[]` — Discovers subagent JSONL files (NEW + OLD structures), parses them, links to Task calls, detects parallel execution
6. **`tool-matcher.ts`** exports: `buildToolExecutions(messages) → ToolExecution[]` — Matches tool calls to results using `sourceToolUseID` (primary) with `toolResults` array fallback
7. **`merger.ts`** exports: `extractFullTimeline(sessionId, dbPath, projectsDir) → FullTimelineSession` — Orchestrates all modules, builds conversation groups, tracks context consumption
8. **`pricing.ts`** exports: `getPricing(modelName) → PricingRate`, `calculateSessionCost(session, turns) → SessionPricing`
9. **`index.ts`** handles: CLI arg parsing, path resolution, orchestration, JSON output
10. **`utils.ts`** handles: Path resolution (`getDbPath()`, `getProjectsDir()`), project name encoding

### Key Improvements from claude-devtools Analysis:
- **Streaming by default**: `readline.createInterface` for line-by-line parsing (not `fs.readFileSync`)
- **RequestId deduplication**: Claude Code writes multiple JSONL entries per API response during streaming; only last entry per `requestId` has final token counts
- **Noise filtering**: Skip `system`, `summary`, `file-history-snapshot`, `queue-operation`, synthetic messages, `<local-command-caveat>`, `<system-reminder>`
- **sourceToolUseID matching**: More reliable than timestamp-based matching for tool call ↔ result pairing
- **Subagent resolution**: Handles both NEW (`{sessionId}/subagents/agent-{id}.jsonl`) and OLD (`{projectId}/agent-{id}.jsonl`) structures
- **Ongoing session detection**: Track activity vs ending events to mark sessions as in-progress
- **Context consumption tracking**: Track tokens across compaction phases

### Scalability Note (for future multi-session support):
- `db-reader.ts` can add `getAllSessions(dbPath) → Session[]`
- `jsonl-parser.ts` can process multiple files in parallel
- `merger.ts` can process in a loop (or parallel with `Promise.all`)
- Subagent resolver can batch-process multiple sessions

---

