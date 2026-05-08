# Claude Code Session Extractor — Design Doc

**Date**: 2026-05-08  
**Author**: Brainstorming Session with User  
**Status**: Approved by User (Sections 1–4)  
**Phase**: 1 — Standalone TypeScript Data Extractor  

---

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

## 2. Data Models (`types.ts`)

Based on `session-report.md` schemas (sections 2.1, 3.3.2, 4.1, 4.2).

### 2.1 Token Usage (per turn/session)

```typescript
// Matches session-report.md Section 2.1 (Token Types table)
export interface TokenUsage {
  inputTokens: number;        // Non-cached input (Section 2.2)
  outputTokens: number;       // Model-generated output (Section 2.2)
  cacheReadTokens: number;     // Cache read (10% of input, same for both tiers)
  
  // 5m vs 1h cache creation (from JSONL usage.cache_creation)
  cacheCreation5mTokens: number;  // 5-minute cache write (1.25x input rate)
  cacheCreation1hTokens: number;  // 1-hour cache write (2x input rate)
  
  // Legacy: total cache creation (for fallback when JSONL breakdown unavailable)
  cacheCreationTokens?: number;    // Sum of 5m + 1h (from SQLite turns table)
}
```

### 2.2 Turn Data (from SQLite `turns` table + JSONL messages)

```typescript
// Matches session-report.md Section 3.3.2 (turns table schema)
// + Section 4.2 (Turn-by-Turn breakdown fields)
export interface Turn {
  timestamp: string;          // From turns table (Section 4.2 per turn)
  tokenUsage: TokenUsage;       // From turns table (cache_read_tokens, etc.)
  toolName?: string;            // From turns table (tool_name column)
  cwd?: string;                // From turns table (working directory)
  messages: Message[];         // From JSONL (assistant/user messages)
  toolCalls: ToolCall[];       // Extracted from JSONL tool_use/tool_result
  
  // Cache tier tracking per turn
  cacheWriteType: '5m' | '1h' | 'none';  // Which tier was WRITTEN this turn
  cacheReadType: '5m' | '1h' | 'unknown';  // Which tier was READ (inferred)
  cacheCreationTokensThisTurn: number;  // Tokens written this specific turn
}
```

### 2.3 JSONL Message Types (from `session.jsonl`)

```typescript
// Matches session-report.md Section 3.3.4 (JSONL structure)
export type MessageContent = TextContent | ToolUseContent | ToolResultContent;

export interface Message {
  type: 'assistant' | 'user' | 'system';
  timestamp?: string;           // From JSONL top-level timestamp
  content: MessageContent[];    // Array of content blocks
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  name: string;                 // e.g., "Bash", "Read", "AskUserQuestion"
  input: Record<string, any>;   // tool-specific: command, filePath, description
  toolUseId: string;            // Links to ToolResultContent
}

export interface ToolResultContent {
  type: 'tool_result';
  toolUseId: string;            // Matches ToolUseContent.toolUseId
  content: string;              // Success output or error message
  isError?: boolean;            // True if tool failed (Section 2.3.1)
}
```

### 2.4 Raw JSONL Record (before normalization)

```typescript
// Raw record from session.jsonl line — contains usage.cache_creation fields
// This is the INTERNAL type used by jsonl-parser.ts, NOT exported to consumers
interface RawJsonlRecord {
  type: string;               // "assistant", "user", "system", etc.
  timestamp?: string;           // Top-level timestamp
  uuid?: string;               // Message UUID (for matching)
  parentUuid?: string;         // Parent message UUID
  message?: {
    role: string;
    content: any[];              // Raw content array (may include usage, etc.)
    model?: string;              // Model used (e.g., "claude-sonnet-4-6")
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens: number;
      cache_creation_input_tokens: number;
      cache_creation?: {
        ephemeral_5m_input_tokens: number;
        ephemeral_1h_input_tokens: number;
      };
      // ... other usage fields
    };
  };
  // For user messages with tool results:
  toolUseResult?: {
    toolUseId: string;
    content: string;
    isError?: boolean;
  };
}
```

**Normalized types (exported to consumers):**

### 2.5 Tool Call (extracted from JSONL tool_use + tool_result pairs)

```typescript
// Matches session-report.md Section 4.2 (Tool Used, Exact Command, Tool Result)
export interface ToolCall {
  toolUseId: string;
  name: string;                 // "Bash", "Read", "Edit", etc.
  input: Record<string, any>;    // command, filePath, description, etc.
  result?: string;               // Output from tool execution
  isError?: boolean;             // Failed tool call?
  timestamp?: string;            // From parent message
}
```

### 2.5 Session Metadata (from SQLite `sessions` + `turns` tables)

```typescript
// Matches session-report.md Section 4.1 (Session Overview table)
// NOTE: model comes from turns table (sessions table does NOT have model column)
// getSession() queries: 
//   1. SELECT * FROM sessions WHERE session_id = ?
//   2. SELECT model FROM turns WHERE session_id = ? LIMIT 1 (get model from first turn)
export interface SessionMetadata {
  sessionId: string;            // From sessions.session_id
  projectName: string;           // From sessions.project_name
  model: string;                 // From turns table (model used, e.g., "claude-sonnet-4-6")
  commandExecuted?: string;       // From session-report.md (e.g., "/claude-hud:setup")
  workingDirectory: string;       // From turns.cwd (first turn's cwd)
  turnCount: number;              // From sessions.turn_count
  totalTokens: TokenUsage;        // From sessions.total_* columns
  startTime: string;             // First turn timestamp
  endTime: string;               // Last turn timestamp
}
```

### 2.6 Pricing Types

```typescript
// Matches Anthropic pricing docs: 5m = 1.25x input, 1h = 2x input
export interface PricingRate {
  model: string;                 // e.g., "claude-sonnet-4-6"
  inputPerMTok: number;           // Base input rate
  outputPerMTok: number;          // Output rate (5x input typically)
  
  // Cache pricing tiers (from Anthropic docs)
  cacheReadPerMTok: number;        // Cache read (0.1x input, same for both)
  cacheCreation5mPerMTok: number;  // 5-minute cache write (1.25x input)
  cacheCreation1hPerMTok: number;  // 1-hour cache write (2x input)
}

// Calculated costs for a turn
export interface TurnPricing {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  
  // Separate costs for each cache tier
  cacheCreation5mCost: number;
  cacheCreation1hCost: number;
  totalCost: number;
}

// Full session pricing summary
export interface SessionPricing {
  totalCost: number;
  turnsPricing: TurnPricing[];   // Per-turn cost breakdown
  pricingRate: PricingRate;       // Model-specific rates used
}
```

### 2.7 Full Timeline Output (merged JSON)

```typescript
// Final output of the extractor (matches session-report.md Appendix B.9)
export interface FullTimelineSession {
  session: SessionMetadata;
  turns: Turn[];
  pricing: SessionPricing;
}
```

### Key References to `session-report.md`:
- Token types: Section 2.1, 2.2
- SQLite schemas: Section 3.3.2 (turns table), 3.3.1 (sessions table)
- JSONL structure: Section 3.3.4
- Turn-by-turn example: Section 4.2 (Turn 1–Turn 28 fields)
- Pricing rates: Section 2.1, Appendix B.3
- Output format: Appendix B.9 (JSON export)

---

## 3. Data Flow

### Step 1: Entry Point (`src/index.ts`)

```
User runs: tsx src/index.ts --session-id <id> [--db-path X] [--projects-dir Y]
          ↓
1. Parse CLI args (sessionId required)
2. Resolve paths:
   - dbPath = --db-path || process.env.CLAUDE_CONFIG_DIR || ~/.claude/usage.db
   - projectsDir = --projects-dir || process.env.CLAUDE_CONFIG_DIR || ~/.claude/projects
3. Call merger.extractFullTimeline(sessionId, dbPath, projectsDir)
4. Output JSON to stdout (or --output file)
```

### Step 2: SQLite Reading (`src/db-reader.ts`)

```
merger calls: dbReader.getSession(dbPath, sessionId)
          ↓
1. Open SQLite DB (better-sqlite3 or sqlite3 package)
2. Query: SELECT * FROM sessions WHERE session_id = ?
3. Return: SessionMetadata (sessionId, projectName, model, turnCount, totalTokens)
          ↓
merger calls: dbReader.getTurns(dbPath, sessionId)
          ↓
1. Query: SELECT * FROM turns WHERE session_id = ? ORDER BY timestamp
2. Return: Turn[] (with tokenUsage, toolName, cwd, but NO messages/toolCalls yet)
```

### Step 3: JSONL Parsing (`src/jsonl-parser.ts`)

```
merger calls: jsonlParser.parseSessionJsonl(jsonlPath, sessionId)
          ↓
1. Construct jsonlPath from projectsDir + session.projectName + sessionId:
   ~/.claude/projects/-Users-abnersoaresalvesjunior/19500eaa-3cc6-4111-a82d-f158e7f76ad3.jsonl
2. Read file line-by-line (or full read for small files)
3. For each line (JSON object):
   - If type === 'assistant' → extract messages (content array)
   - If type === 'user' AND content has tool_result → extract tool call results
   - Match tool_use_id between tool_use and tool_result to pair them
4. Return: { messages: Message[], toolCalls: ToolCall[] }
```

### Step 4: Merging (`src/merger.ts`)

```
merger.extractFullTimeline(sessionId, dbPath, projectsDir)
          ↓
1. Get session metadata from dbReader.getSession()
2. Get turns from dbReader.getTurns()
3. Get projectName from session, construct JSONL path
4. Parse JSONL: jsonlParser.parseSessionJsonl(jsonlPath, sessionId)
   - Returns: { rawMessages: RawJsonlRecord[], toolCalls: ToolCall[] }
5. For each Turn from SQLite (index i):
   a. MATCHING ALGORITHM (deterministic):
      - Primary: Find RawJsonlRecord with timestamp within 5 seconds of turn.timestamp
      - Secondary: If multiple matches, use the one with matching uuid (if turn has uuid)
      - Fallback: Use the i-th assistant message in JSONL (assumes ordered)
   b. Normalize RawJsonlRecord → Message (extract content array, handle usage field)
   c. Find tool calls that belong to this turn (by timestamp proximity)
   d. Extract cache creation breakdown from RawJsonlRecord.usage.cache_creation
   e. Infer cacheReadType (see Section 2 assumption notes)
   f. Attach messages + toolCalls to the Turn object
6. Calculate pricing: pricing.calculateSessionCost(session, turns)
7. Return: FullTimelineSession
```

**Turn Matching Rules (deterministic):**
- Each SQLite turn has a `timestamp` (from turns table)
- Each JSONL assistant message has a `timestamp` (top-level field)
- Match if: `abs(turn.timestamp - jsonlMsg.timestamp) < 5 seconds`
- If multiple JSONL messages match, pick the one with matching `uuid` (if turn has uuid)
- If no match by timestamp, use index-based: turn[i] → jsonlMessages[i] (assumes both are ordered by time)

### Step 5: Pricing Calculation (`src/pricing.ts`)

```
pricing.calculateSessionCost(session, turns)
          ↓
1. Lookup model pricing: getPricing(session.model)
   - If model unknown → use fallback rates, log warning
   - If model known → get inputPerMTok, outputPerMTok, cacheCreation5mPerMTok, etc.
2. For each Turn:
   a. Calculate turn cost using TokenUsage + PricingRate
   b. Separate cacheCreation5mCost vs cacheCreation1hCost
   c. Infer cache read cost based on cacheReadType (default to 5m rate if unknown)
3. Sum all turn costs → SessionPricing.totalCost
4. Return: SessionPricing
```

### Step 6: JSON Output (`src/index.ts`)

```
FullTimelineSession (from merger)
          ↓
1. JSON.stringify(fullTimeline, null, 2)  // Pretty print
2. Output to stdout (or write to --output file)
3. Structure matches Appendix B.9 from session-report.md
```

### Data Flow Diagram (Text-Based)

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  SQLite DB │     │  JSONL File  │     │  Pricing DB  │
│ usage.db   │     │  session.jsonl│     │  (hardcoded) │
└─────┬───────┘     └──────┬───────┘     └──────┬───────┘
      │                    │                    │
      ▼                    ▼                    ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│ db-reader.ts│     │jsonl-parser.ts│     │ pricing.ts   │
│ (sessions,  │     │ (messages,   │     │ (model rates,│
│  turns)     │     │  tool calls) │     │  cost calc)  │
└─────┬───────┘     └──────┬───────┘     └──────┬───────┘
      │                    │                    │
      └────────────────────┼────────────────────┘
                           ▼
                    ┌──────────────┐
                    │ merger.ts    │
                    │ (merge all, │
                    │  infer cache│
                    │  types)     │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ index.ts     │
                    │ (output     │
                    │  JSON)      │
                    └──────────────┘
```

### Key Design Decisions for Data Flow:
1. **SQLite is authoritative for token counts** (matches billed amounts in `usage.db`)
2. **JSONL is authoritative for cache tier breakdown** (has `ephemeral_5m_input_tokens` vs `ephemeral_1h_input_tokens`)
3. **Pricing is hardcoded** (no external API calls, as discussed)
4. **Cache read type is inferred** (see Section 2 notes + CONTRIBUTING.md)

---

## 4. Error Handling & Edge Cases

### 4.1 Session Not Found (SQLite)

```typescript
// src/db-reader.ts
function getSession(dbPath: string, sessionId: string): SessionMetadata {
  let db: Database;
  try {
    db = openDb(dbPath);
  } catch (err) {
    // Handle DB open failures (file not found, permission errors, corrupt DB)
    throw new Error(
      `Failed to open SQLite DB: ${dbPath}\n` +
      `  Error: ${err.message}\n` +
      `  Tip: Check file permissions and ensure the path points to a valid SQLite database`
    );
  }

  try {
    const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
  
    if (!row) {
      // THROW with clear error — this is a hard failure
      throw new Error(
        `Session not found: ${sessionId}\n` +
        `  DB: ${dbPath}\n` +
        `  Tip: Use 'sqlite3 ${dbPath} "SELECT session_id FROM sessions LIMIT 5;"' to list available sessions`
      );
    }
    return mapRowToSessionMetadata(row);
  } catch (err) {
    // Handle query failures
    throw new Error(
      `Failed to query session: ${err.message}\n` +
      `  DB: ${dbPath}\n` +
      `  Session ID: ${sessionId}`
    );
  }
}
```

### 4.2 JSONL File Not Found

```typescript
// src/merger.ts
// Returns null if file not found — caller must handle null case
function findJsonlPath(projectsDir: string, projectName: string, sessionId: string): string | null {
  // Project name encoding: Replace "/" with "-" (matches Claude Code's encoding)
  // Example: "/Users/abnersoaresalvesjunior" → "-Users-abnersoaresalvesjunior"
  // Note: This is a simplified encoding. If JSONL file not found, try:
  // 1. URL-encoded version: encodeURIComponent(projectName)
  // 2. Base64 encoded version (if Claude Code uses that)
  const encodedProject = projectName.replace(/\//g, '-');
  const jsonlPath = path.join(projectsDir, encodedProject, `${sessionId}.jsonl`);
  
  if (!fs.existsSync(jsonlPath)) {
    // Try URL-encoded version as fallback
    const urlEncoded = encodeURIComponent(projectName);
    const urlPath = path.join(projectsDir, urlEncoded, `${sessionId}.jsonl`);
    if (fs.existsSync(urlPath)) return urlPath;
    
    // WARN, not throw — we can still return SQLite data without JSONL
    console.warn(
      `⚠️  JSONL file not found: ${jsonlPath}\n` +
      `   Also tried: ${urlPath}\n` +
      `   Session will have empty messages/toolCalls.\n` +
      `   Tip: Check project_name encoding in SQLite vs actual directory name.`
    );
    return null;
  }
  return jsonlPath;
}
```

### 4.3 Malformed JSONL Lines

```typescript
// src/jsonl-parser.ts
function parseSessionJsonl(jsonlPath: string, sessionId: string): ParsedData {
  const lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean);
  const messages: Message[] = [];
  const toolCalls: ToolCall[] = [];
  let malformedCount = 0;

  for (const [index, line] of lines.entries()) {
    try {
      const obj = JSON.parse(line);
      // Process object...
    } catch (err) {
      malformedCount++;
      console.warn(`⚠️  Skipping malformed JSONL line ${index + 1}: ${err.message}`);
      // Continue to next line — don't fail the whole session
    }
  }

  if (malformedCount > 0) {
    console.warn(`⚠️  Skipped ${malformedCount} malformed lines out of ${lines.length} total.`);
  }
  return { messages, toolCalls };
}
```

### 4.4 Cache Creation Breakdown Missing (Fallback)

```typescript
// src/merger.ts
function extractTurnTokenUsage(sqliteTurn: any, jsonlMessages: Message[]): TokenUsage {
  const usage: TokenUsage = {
    inputTokens: sqliteTurn.input_tokens,
    outputTokens: sqliteTurn.output_tokens,
    cacheReadTokens: sqliteTurn.cache_read_tokens,
    cacheCreationTokens: sqliteTurn.cache_creation_tokens, // Fallback total
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
  };

  // Try JSONL breakdown first
  const assistantMsg = jsonlMessages.find(m => m.message?.usage?.cache_creation);
  if (assistantMsg?.message?.usage?.cache_creation) {
    const creation = assistantMsg.message.usage.cache_creation;
    usage.cacheCreation5mTokens = creation.ephemeral_5m_input_tokens || 0;
    usage.cacheCreation1hTokens = creation.ephemeral_1h_input_tokens || 0;
  } else {
    // ASSUMPTION: If no breakdown, treat all as 5m (default TTL)
    // See CONTRIBUTING.md > Key Assumptions for details
    console.warn(
      `⚠️  No cache creation breakdown in JSONL for turn at ${sqliteTurn.timestamp}.\n` +
      `   Assuming all cache writes are 5-minute TTL (default).`
    );
    usage.cacheCreation5mTokens = usage.cacheCreationTokens || 0;
  }

  return usage;
}
```

### 4.5 Unknown Model Pricing

```typescript
// src/pricing.ts
function getPricing(modelName: string): PricingRate {
  const rate = PRICING_TABLE[modelName];
  if (!rate) {
    // WARN, use fallback rates (Sonnet 4.6 as default)
    console.warn(
      `⚠️  Unknown model: "${modelName}". Using fallback pricing (Sonnet 4.6 rates).\n` +
      `   Tip: Add this model to PRICING_TABLE in src/pricing.ts`
    );
    return PRICING_TABLE['claude-sonnet-4-6']; // Fallback
  }
  return rate;
}
```

### 4.6 Time Parsing Errors (Cache Read Inference)

```typescript
// src/merger.ts
// NOTE: cacheReadType is for UI display ONLY.
// Pricing is the SAME for both tiers (cacheReadPerMTok = 0.1x input, regardless of 5m vs 1h).
// This inference is NOT definitive — see CONTRIBUTING.md > Key Assumptions.
function inferCacheReadType(
  turnIndex: number,
  turns: Turn[],
  currentTurnTime: string
): '5m' | '1h' | 'unknown' {
  try {
    const currentTime = new Date(currentTurnTime).getTime();
    if (isNaN(currentTime)) throw new Error('Invalid timestamp');
    
    const prevTurn = turns[turnIndex - 1];
    // NOTE: 'unknown' is only for actual errors, NOT for "could not determine" cases.
    // Default is '5m' (most sessions use 5m TTL).
    if (!prevTurn) return '5m'; // No previous turn — assume 5m default
    
    const prevTime = new Date(prevTurn.timestamp).getTime();
    if (isNaN(prevTime)) throw new Error('Invalid previous timestamp');
    
    const timeDiff = currentTime - prevTime;
    
    if (prevTurn.cacheWriteType === '1h' && timeDiff < 60 * 60 * 1000) return '1h';
    if (prevTurn.cacheWriteType === '5m' && timeDiff < 5 * 60 * 1000) return '5m';
    
    return '5m'; // Default assumption (matches Anthropic's default TTL)
  } catch (err) {
    console.warn(`⚠️  Could not infer cache read type: ${err.message}`);
    return 'unknown'; // Only on actual parse errors
  }
}
```

### 4.7 CLI Argument Validation & Output Handling

```typescript
// src/index.ts
function parseArgs(argv: string[]): Config {
  const args = minimist(argv.slice(2));
  
  if (!args['session-id']) {
    console.error(
      `Error: --session-id is required.\n` +
      `Usage: tsx src/index.ts --session-id <id> [options]\n` +
      `Options:\n` +
      `  --db-path <path>       SQLite DB path (default: ~/.claude/usage.db)\n` +
      `  --projects-dir <path>   Projects directory (default: ~/.claude/projects)\n` +
      `  --output <path>         Write JSON to file instead of stdout`
    );
    process.exit(1);
  }
  
  return {
    sessionId: args['session-id'],
    dbPath: args['db-path'] || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude', 'usage.db'),
    projectsDir: args['projects-dir'] || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude', 'projects'),
    outputPath: args['output'] || null,
  };
}

// Output JSON (handles both stdout and file output)
function outputJSON(data: FullTimelineSession, outputPath: string | null): void {
  const json = JSON.stringify(data, null, 2);
  
  if (outputPath) {
    try {
      fs.writeFileSync(outputPath, json, 'utf-8');
      console.log(`✅ Output written to: ${outputPath}`);
    } catch (err) {
      console.error(`❌ Failed to write output file: ${outputPath}`);
      console.error(`   Error: ${err.message}`);
      console.error(`   Tip: Check file permissions and disk space.`);
      // Fallback to stdout
      console.log(json);
    }
  } else {
    console.log(json);
  }
}
```

### Error Handling Summary Table

| Error | Severity | Action | User Message |
|-------|-----------|--------|--------------|
| Session not in SQLite | Fatal | Throw error | Show session ID + tip to list sessions |
| JSONL file missing | Warning | Continue with empty messages | Warn + tip about project encoding |
| Malformed JSONL line | Warning | Skip line, continue | Count of skipped lines |
| Cache breakdown missing | Warning | Fallback to 5m assumption | Explain assumption, reference CONTRIBUTING.md |
| Unknown model | Warning | Use fallback pricing | Show model name, suggest updating pricing.ts |
| Time parse error | Warning | Return 'unknown' for cache read | Log error, default to 5m |
| Missing --session-id | Fatal | Exit with usage help | Show usage + options |

---

## 5. Key Assumptions & Caveats

### 5.1 Cache Read Type Inference (Important!)

**File**: `src/merger.ts`, `src/types.ts`

The Claude API **does not** tag cache read tokens with their TTL (5-minute vs 1-hour). The API response only includes:

```json
"cache_creation": {
  "ephemeral_5m_input_tokens": 456,
  "ephemeral_1h_input_tokens": 100
}
```

For **cache writes**, we know the exact tier from `ephemeral_5m_input_tokens` vs `ephemeral_1h_input_tokens`.

For **cache reads**, we **infer** the type based on:
1. Looking at the previous turn's cache write type
2. Checking if the time difference is within the TTL window (5 min for 5m, 1 hour for 1h)
3. Defaulting to '5m' if uncertain (most sessions use default 5m TTL)

**This inference is NOT definitive.** The API doesn't provide this information. For display purposes in the UI, this inference is good enough, but do not use it for billing audits without verification.

**Code locations to check**:
- `src/types.ts`: `Turn.cacheReadType` field (type: `'5m' | '1h' | 'unknown'`)
- `src/merger.ts`: `inferCacheReadType()` function (contains the inference logic)
- `src/pricing.ts`: Uses `cacheReadType` for cost calculation (falls back to 5m rate if unknown)

### 5.2 SQLite vs JSONL Data Priority

**File**: `src/merger.ts`

When merging data from SQLite (`usage.db`) and JSONL (`session.jsonl`):
- **JSONL is preferred** for cache creation breakdown (has `ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`)
- **SQLite is used as fallback** when JSONL data is unavailable or malformed
- **Token counts** from SQLite `turns` table are considered authoritative (matches what was billed)

### 5.3 Model Pricing Rates

**File**: `src/pricing.ts`

Pricing rates are hardcoded from Anthropic's published docs (as of April 2026). When new models release:
1. Update the `PRICING_TABLE` in `src/pricing.ts`
2. Add tests for the new model
3. Check if cache pricing tiers changed (5m = 1.25x input, 1h = 2x input as of Sonnet 4.6)

### 5.4 Path Resolution

**File**: `src/utils.ts`

The extractor respects `CLAUDE_CONFIG_DIR` env var, defaulting to `~/.claude`. The JSONL file path is constructed as:
```
~/.claude/projects/<encoded_project_name>/<session_id>.jsonl
```

The `encoded_project_name` is derived from the `sessions.project_name` field in SQLite (e.g., `/Users/abnersoaresalvesjunior` → `-Users-abnersoaresalvesjunior`).

---

## 6. Future: Streaming Parser Integration

See `docs/streaming-parser-plan.md` for detailed integration strategy.

**Why Streaming Parsing?**
- Large sessions (1000+ turns) where in-memory JSONL parsing uses excessive RAM
- Low latency: Start processing before entire file is read
- Future WebUI: Stream partial results to browser as they're parsed
- Parallel multi-session: Process multiple sessions concurrently with bounded memory

**Integration Strategy**:
- Keep original `jsonl-parser.ts` as default (simple, works for 99% of sessions)
- Add `streaming-jsonl-parser.ts` as optional upgrade
- Update `merger.ts` to accept either in-memory or streaming input
- Add config flag: `useStreaming: boolean` (default: false)

---

## 7. Output Format

### JSON Structure (matches Appendix B.9 from session-report.md)

```json
{
  "session": {
    "sessionId": "19500eaa-3cc6-4111-a82d-f158e7f76ad3",
    "projectName": "/Users/abnersoaresalvesjunior",
    "model": "claude-sonnet-4-6",
    "commandExecuted": "/claude-hud:setup",
    "workingDirectory": "/Users/abnersoaresalvesjunior",
    "turnCount": 28,
    "totalTokens": { /*...*/ },
    "startTime": "2026-05-07T19:22:45.118Z",
    "endTime": "2026-05-07T19:30:01.208Z"
  },
  "turns": [
    {
      "timestamp": "2026-05-07T19:22:45.118Z",
      "tokenUsage": {
        "inputTokens": 2,
        "outputTokens": 323,
        "cacheReadTokens": 12143,
        "cacheCreation5mTokens": 0,
        "cacheCreation1hTokens": 12973,
        "cacheCreationTokens": 12973
      },
      "toolName": "Bash",
      "cacheWriteType": "1h",
      "cacheReadType": "1h",
      "messages": [ /*...*/ ],
      "toolCalls": [ /*...*/ ]
    }
    /*... 27 more turns */
  ],
  "pricing": {
    "totalCost": 0.6261,
    "turnsPricing": [ /* per-turn costs */ ],
    "pricingRate": {
      "model": "claude-sonnet-4-6",
      "inputPerMTok": 3.00,
      "outputPerMTok": 15.00,
      "cacheReadPerMTok": 0.30,
      "cacheCreation5mPerMTok": 3.75,
      "cacheCreation1hPerMTok": 6.00
    }
  }
}
```

---

## 8. Tech Stack & Conventions

- **Language**: TypeScript, Node.js (no Bun)
- **Linting/Formatting**: Biome only (biome.json config). No ESLint, no Prettier.
- **Editor**: Follow `.editorconfig`
- **Module Structure**: Modular package with clear separation (see Section 1)
- **Output**: Unified JSON per session, matching schemas from `session-report.md`
- **Path Resolution**: Respect `CLAUDE_CONFIG_DIR` env var, default to `~/.claude`

---

## 9. References

- `session-report.md` — Data schemas, investigation methodology, turn-by-turn examples
- `docs/streaming-parser-plan.md` — Future streaming parser integration
- `CONTRIBUTING.md` — Contributor guidelines, assumptions documentation
- `AGENTS.md` — Project-specific instructions and conventions
- Anthropic Pricing Docs — https://docs.anthropic.com/en/docs/about-claude/pricing
- Anthropic Prompt Caching Docs — https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching

---

**End of Design Doc**
