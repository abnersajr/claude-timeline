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

