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

