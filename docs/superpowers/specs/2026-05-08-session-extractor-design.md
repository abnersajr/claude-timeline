## 1. Architecture Overview & Module Structure

### Approach: Modular Package (Approach 2)

Split into focused modules with clear interfaces:

```
timeline/
├── src/
│   ├── types.ts            # Shared TypeScript interfaces
│   ├── db-reader.ts       # SQLite usage.db reading (sessions, turns)
│   ├── jsonl-parser.ts    # JSONL session file parsing (messages, tool calls)
│   ├── merger.ts          # Merge SQLite + JSONL data by session_id
│   ├── pricing.ts         # Built-in model pricing lookup table
│   ├── index.ts           # Main extractor entry point (standalone runner)
│   └── utils.ts          # Path resolution, env var handling (CLAUDE_CONFIG_DIR)
├── docs/
│   ├── streaming-parser-plan.md   # Future integration plan
│   └── superpowers/specs/      # Design docs (this file)
├── package.json
├── tsconfig.json
├── biome.json             # Biome config (no ESLint/Prettier)
├── .editorconfig
├── .gitignore
├── README.md
├── AGENTS.md
├── CLAUDE.md
└── CONTRIBUTING.md
```

### Key Design Decisions:
1. **`types.ts`** defines core interfaces: `Session`, `Turn`, `ToolCall`, `Message`, `PricingRate`, `RawJsonlRecord` — matching the schemas from `session-report.md`
2. **`db-reader.ts`** exports: `getSession(dbPath, sessionId) → Session`, `getTurns(dbPath, sessionId) → Turn[]`
3. **`jsonl-parser.ts`** exports: `parseSessionJsonl(jsonlPath, sessionId) → { rawMessages: RawJsonlRecord[], toolCalls: ToolCall[] }` (returns raw records, merger handles normalization)
4. **`merger.ts`** exports: `mergeSessionData(session, turns, rawMessages, toolCalls) → FullTimelineSession`
5. **`pricing.ts`** exports: `getPricing(modelName) → PricingRate`, `calculateCost(turn, pricing) → TurnCost`
6. **`index.ts`** handles: CLI arg parsing (for standalone use), path resolution (via `utils.ts`), orchestration, JSON output
7. **`utils.ts`** handles: Path resolution (`getDbPath()`, `getProjectsDir()`), project name encoding

### Scalability Note (for future multi-session support):
- `db-reader.ts` can add `getAllSessions(dbPath) → Session[]`
- `jsonl-parser.ts` can iterate multiple JSONL files
- `merger.ts` can process in a loop (or parallel with `Promise.all`)
- Streaming parser can replace `jsonl-parser.ts` later without changing other modules (interface-compatible)

---

