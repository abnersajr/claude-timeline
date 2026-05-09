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
1. Open SQLite DB (better-sqlite3)
2. Query: SELECT * FROM sessions WHERE session_id = ?
3. Return: SessionMetadata (sessionId, projectName, model, turnCount, totalTokens)
          ↓
merger calls: dbReader.getTurns(dbPath, sessionId)
          ↓
1. Query: SELECT * FROM turns WHERE session_id = ? ORDER BY timestamp
2. Return: Turn[] (with tokenUsage, toolName, cwd, but NO messages/toolCalls yet)
```

### Step 3: Streaming JSONL Parsing (`src/jsonl-parser.ts`)

Uses `readline.createInterface` for streaming line-by-line parsing (not `fs.readFileSync`).

```
merger calls: jsonlParser.parseSessionJsonl(jsonlPath)
          ↓
1. Construct jsonlPath from projectsDir + session.projectName + sessionId
2. Create streaming readline interface:
   const fileStream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
   const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
3. For each line (streaming):
   a. Parse JSON (skip malformed lines, increment malformedCount)
   b. Skip entries without uuid (metadata entries)
   c. Parse entry type → MessageType
   d. Extract all metadata fields:
      - uuid, parentUuid (message threading)
      - isSidechain, isMeta, isCompactSummary (classification)
      - sourceToolUseID, sourceToolAssistantUUID (tool linking)
      - agentId, requestId, cwd, gitBranch
      - userType, toolUseResult
   e. Extract tool calls from content blocks (tool_use)
   f. Extract tool results from content blocks (tool_result)
   g. Parse usage → TokenUsage (with cache_creation breakdown)
4. Deduplicate by requestId (keep LAST entry per requestId):
   - Claude Code writes multiple entries per API response during streaming
   - Only last entry per requestId has final, complete token counts
   - Messages without requestId pass through unchanged
5. Filter noise via noise-filter.ts:
   - Skip: system, summary, file-history-snapshot, queue-operation types
   - Skip: synthetic assistant messages (model='<synthetic>')
   - Skip: sidechain messages (isSidechain=true)
   - Skip: user messages with ONLY <local-command-caveat> or <system-reminder>
6. Return: ParsedMessage[] (filtered, deduplicated)
```

### Step 4: Noise Filtering (`src/noise-filter.ts`)

```
Called by jsonl-parser.ts during streaming parse:
          ↓
isDisplayableEntry(entry):
  1. Check entry type → skip system, summary, file-history-snapshot, queue-operation
  2. Check isSidechain → skip subagent messages
  3. Check model → skip synthetic (model='<synthetic>')
  4. For user messages:
     - Check isMeta → keep (internal tool results, part of AI flow)
     - Check content for hard noise tags → skip <local-command-caveat>, <system-reminder>
     - Check for command output → keep <local-command-stdout>, <local-command-stderr>
     - Keep real user input
  5. For assistant messages → keep (creates AI chunk)

classifyMessage(msg) → MessageCategory:
  - 'hardNoise': filtered out entirely
  - 'compact': compaction summary messages
  - 'system': command output (<local-command-stdout>)
  - 'user': real user input
  - 'ai': assistant messages, tool results
```

### Step 5: Tool Call ↔ Result Matching (`src/tool-matcher.ts`)

Uses `sourceToolUseID` as primary matching (more reliable than timestamp matching).

```
Called by merger.ts after JSONL parsing:
          ↓
buildToolExecutions(messages: ParsedMessage[]) → ToolExecution[]:
  1. First pass: collect all tool calls from assistant messages
     - Map: toolCallId → { call: ToolCall, startTime: Date }
  2. Second pass: match with results
     a. PRIMARY: Check sourceToolUseID on internal user messages
        - If sourceToolUseID matches a tool call → create ToolExecution
        - This is the most accurate matching method
     b. FALLBACK: Check toolResults array
        - For results not matched via sourceToolUseID
        - Match by toolUseId in toolResults array
  3. Add calls without results (pending/failed)
  4. Sort by startTime
  5. Return: ToolExecution[]
```

### Step 6: Subagent Resolution (`src/subagent-resolver.ts`)

Handles both NEW and OLD subagent directory structures.

```
Called by merger.ts after tool matching:
          ↓
resolveSubagents(projectId, sessionId, taskCalls, messages) → Subagent[]:
  1. Discover subagent files:
     - NEW structure: {projectId}/{sessionId}/subagents/agent-{id}.jsonl
     - OLD structure: {projectId}/agent-{id}.jsonl (filter by sessionId)
  2. Parse each subagent file (streaming readline):
     - Skip warmup subagents (first user message = "Warmup")
     - Skip compact files (agentId starts with 'acompact')
     - Extract timing (startTime, endTime, durationMs)
     - Calculate metrics (tokens, message count)
     - Check if ongoing (last event is activity, not ending)
  3. Link to Task calls:
     a. PRIMARY: Match by agentId from tool results
        - Tool results for Task calls contain agentId field
        - Match agentId → subagent file ID
     b. SECONDARY: Match by description (for team spawns)
        - Compare Task description to <teammate-message summary="..."> in subagent
     c. FALLBACK: Positional matching (without wrap-around)
  4. Propagate team metadata via parentUuid chain
  5. Detect parallel execution (100ms overlap window):
     - Group subagents by start time
     - Mark agents in groups with multiple members as parallel
  6. Enrich team colors from tool results
  7. Sort by startTime
  8. Return: Subagent[]
```

### Step 7: Conversation Grouping (`src/merger.ts`)

Groups one user message with all AI responses until the next user message.

```
buildConversationGroups(messages, subagents) → ConversationGroup[]:
  1. Filter to main thread only (not sidechain)
  2. Find all real user messages (isParsedUserChunkMessage)
  3. For each user message:
     a. Collect all AI responses until next user message
     b. Separate Task executions from regular tool executions
     c. Link subagents to group by timing
     d. Calculate group timing and metrics
  4. Return: ConversationGroup[]
```

### Step 8: Context Consumption Tracking (`src/merger.ts`)

Tracks context window consumption across compaction phases.

```
trackContextConsumption(messages) → { contextConsumption, compactionCount, phaseBreakdown }:
  1. Track main-thread assistant input tokens
  2. Detect compaction events (isCompactSummary flag)
  3. Calculate per-phase contribution:
     - Phase 1: tokens up to first compaction
     - Middle phases: contribution = pre[i] - post[i-1]
     - Last phase: final tokens - last post-compaction
  4. Return: contextConsumption (total), compactionCount, phaseBreakdown[]
```

### Step 9: Ongoing Session Detection (`src/merger.ts`)

Detects if a session is still active.

```
checkSessionOngoing(messages) → boolean:
  1. Track "activity" events: thinking blocks, tool_use blocks
  2. Track "ending" events: text output, ExitPlanMode, shutdown_response, user rejection
  3. If last event is activity (not ending) → session is ongoing
  4. Stale threshold: 5 minutes without file modification → dead session
  5. Return: isOngoing boolean
```

### Step 10: Merging (`src/merger.ts`)

```
merger.extractFullTimeline(sessionId, dbPath, projectsDir)
          ↓
1. Get session metadata from dbReader.getSession()
2. Get turns from dbReader.getTurns()
3. Get projectName from session, construct JSONL path
4. Parse JSONL (streaming): jsonlParser.parseSessionJsonl(jsonlPath)
   - Returns: ParsedMessage[] (filtered, deduplicated)
5. Match tool calls to results: toolMatcher.buildToolExecutions(messages)
   - Returns: ToolExecution[]
6. Resolve subagents: subagentResolver.resolveSubagents(projectId, sessionId, taskCalls, messages)
   - Returns: Subagent[]
7. Build conversation groups: buildConversationGroups(messages, subagents)
   - Returns: ConversationGroup[]
8. Track context consumption: trackContextConsumption(messages)
   - Returns: { contextConsumption, compactionCount, phaseBreakdown }
9. Detect ongoing status: checkSessionOngoing(messages)
   - Returns: isOngoing boolean
10. For each Turn from SQLite (index i):
    a. MATCHING ALGORITHM (deterministic):
       - Primary: Find ParsedMessage with timestamp within 5 seconds of turn.timestamp
       - Secondary: If multiple matches, use the one with matching uuid
       - Fallback: Use the i-th assistant message in JSONL (assumes ordered)
    b. Attach matched messages + tool executions to Turn
    c. Attach conversation group to Turn
    d. Extract cache creation breakdown from ParsedMessage.usage
    e. Infer cacheReadType
11. Calculate pricing: pricing.calculateSessionCost(session, turns)
12. Return: FullTimelineSession
```

### Data Flow Diagram (Text-Based)

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  SQLite DB  │     │  JSONL File  │     │  Pricing DB  │
│  usage.db   │     │ session.jsonl│     │  (hardcoded) │
└─────┬───────┘     └──────┬───────┘     └──────┬───────┘
      │                    │                    │
      ▼                    ▼                    ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│ db-reader.ts│     │jsonl-parser.ts│     │ pricing.ts   │
│ (sessions,  │     │ (streaming,  │     │ (model rates,│
│  turns)     │     │  dedup,      │     │  cost calc)  │
│             │     │  noise filter│     │              │
└─────┬───────┘     └──────┬───────┘     └──────┬───────┘
      │                    │                    │
      │              ┌─────┴─────┐              │
      │              ▼           ▼              │
      │     ┌──────────────┐ ┌──────────────┐  │
      │     │noise-filter.ts│ │tool-matcher.ts│ │
      │     │ (classify,   │ │ (sourceTool  │  │
      │     │  filter)     │ │  UseID match)│  │
      │     └──────────────┘ └──────────────┘  │
      │                    │                    │
      │              ┌─────┴─────┐              │
      │              ▼           ▼              │
      │     ┌──────────────┐ ┌──────────────┐  │
      │     │subagent-     │ │conversation  │  │
      │     │resolver.ts   │ │grouping      │  │
      │     │ (discover,   │ │ (user+AI     │  │
      │     │  parse, link)│ │  grouping)   │  │
      │     └──────────────┘ └──────────────┘  │
      │                    │                    │
      └────────────────────┼────────────────────┘
                           ▼
                    ┌──────────────┐
                    │ merger.ts    │
                    │ (orchestrate,│
                    │  match turns,│
                    │  track ctx)  │
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
1. **Streaming by default** — `readline.createInterface` for all JSONL parsing
2. **RequestId deduplication** — Keep only last entry per requestId (streaming artifact)
3. **Noise filtering** — Skip system/summary/synthetic/hard-noise messages
4. **sourceToolUseID matching** — Primary method for tool call ↔ result pairing
5. **Subagent resolution** — Handle both NEW and OLD directory structures
6. **Conversation grouping** — Group user message + AI responses
7. **Context consumption tracking** — Track tokens across compaction phases
8. **Ongoing detection** — Mark sessions as in-progress vs completed
9. **SQLite authoritative for tokens** — Matches billed amounts in usage.db
10. **JSONL authoritative for cache breakdown** — Has 5m/1h breakdown

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

