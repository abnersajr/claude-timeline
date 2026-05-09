## 2. Data Models (`types.ts`)

Based on `session-report.md` schemas (sections 2.1, 3.3.2, 4.1, 4.2) and [claude-devtools](https://github.com/matt1398/claude-devtools) data model.

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

### 2.2 ParsedMessage (complete JSONL entry — primary data type)

Inspired by claude-devtools' `ParsedMessage`. This is the core type returned by the streaming JSONL parser.

```typescript
// Complete parsed JSONL entry with all metadata fields
// Source: claude-devtools types + session-report.md Section 3.3.4
export interface ParsedMessage {
  // Identity
  uuid: string;                          // Message UUID
  parentUuid: string | null;             // Parent message UUID (for threading)
  
  // Type & Role
  type: MessageType;                     // 'user' | 'assistant' | 'system' | 'summary' | 'file-history-snapshot' | 'queue-operation'
  role?: string;                         // 'user' | 'assistant'
  
  // Content
  content: string | ContentBlock[];      // String or array of content blocks
  timestamp: Date;                       // Parsed timestamp
  
  // Token Usage (from assistant messages)
  usage?: TokenUsage;                    // Token counts for this message
  model?: string;                        // Model used (e.g., "claude-sonnet-4-6")
  requestId?: string;                    // API request ID (for streaming dedup)
  
  // Metadata
  cwd?: string;                          // Working directory
  gitBranch?: string;                    // Git branch name
  agentId?: string;                      // Subagent ID (if subagent message)
  
  // Message Classification
  isSidechain: boolean;                  // true = subagent message, false = main thread
  isMeta: boolean;                       // true = internal tool result message
  isCompactSummary: boolean;             // true = compaction summary message
  userType?: string;                     // User message subtype
  
  // Tool Call Linking
  sourceToolUseID?: string;             // Links tool result → tool call (most accurate)
  sourceToolAssistantUUID?: string;      // Links to assistant message that made the call
  toolUseResult?: Record<string, unknown>; // Enriched tool result data
  
  // Extracted Tool Info
  toolCalls: ToolCall[];                 // Tool calls from this message
  toolResults: ToolResult[];             // Tool results from this message
}

export type MessageType = 'user' | 'assistant' | 'system' | 'summary' | 'file-history-snapshot' | 'queue-operation';

export type MessageCategory = 'user' | 'system' | 'compact' | 'hardNoise' | 'ai';

// Content blocks within messages
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'image';
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  isError?: boolean;
}
```

### 2.3 Tool Call & Tool Result

```typescript
// Tool call extracted from assistant messages
// Matches session-report.md Section 4.2 (Tool Used, Exact Command, Tool Result)
export interface ToolCall {
  id: string;                          // Tool use ID (matches ToolResult.toolUseId)
  name: string;                        // "Bash", "Read", "Edit", "Task", etc.
  input: Record<string, unknown>;      // Tool-specific input (command, filePath, etc.)
  isTask: boolean;                     // true if this is a Task (subagent) call
  taskDescription?: string;            // Task description (for Task calls)
  taskSubagentType?: string;           // Subagent type (for Task calls)
}

// Tool result from user messages (internal/meta)
export interface ToolResult {
  toolUseId: string;                   // Matches ToolCall.id
  content: string | ContentBlock[];    // Tool output
  isError?: boolean;                   // Failed tool call?
}

// Matched tool execution (call + result + timing)
export interface ToolExecution {
  toolCall: ToolCall;
  result?: ToolResult;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
}
```

### 2.4 Turn Data (from SQLite `turns` table + JSONL messages)

```typescript
// Matches session-report.md Section 3.3.2 (turns table schema)
// + Section 4.2 (Turn-by-Turn breakdown fields)
export interface Turn {
  timestamp: string;          // From turns table (Section 4.2 per turn)
  tokenUsage: TokenUsage;       // From turns table (cache_read_tokens, etc.)
  toolName?: string;            // From turns table (tool_name column)
  cwd?: string;                // From turns table (working directory)
  messages: ParsedMessage[];   // From JSONL (matched messages)
  toolCalls: ToolCall[];       // Extracted from JSONL tool_use/tool_result
  toolExecutions: ToolExecution[]; // Matched call+result pairs
  
  // Cache tier tracking per turn
  cacheWriteType: '5m' | '1h' | 'none';  // Which tier was WRITTEN this turn
  cacheReadType: '5m' | '1h' | 'unknown';  // Which tier was READ (inferred)
  cacheCreationTokensThisTurn: number;  // Tokens written this specific turn
  
  // Conversation grouping
  conversationGroup?: ConversationGroup; // User message + AI responses
}
```

### 2.5 Conversation Group (user message + AI responses)

Inspired by claude-devtools' `ConversationGroupBuilder`. Groups one user message with all AI responses until the next user message.

```typescript
// One user message + all AI responses until next user message
export interface ConversationGroup {
  id: string;                          // e.g., "group-1"
  userMessage: ParsedMessage;          // The user message that started this group
  aiResponses: ParsedMessage[];        // All AI responses until next user message
  subagents: Subagent[];               // Subagents spawned in this group
  toolExecutions: ToolExecution[];     // Regular tool executions
  taskExecutions: TaskExecution[];     // Task (subagent) executions
  startTime: Date;
  endTime: Date;
  durationMs: number;
  metrics: GroupMetrics;
}

// Task execution (links Task call to subagent)
export interface TaskExecution {
  taskCall: ToolCall;
  taskCallTimestamp: Date;
  subagent: Subagent;
  toolResult: ParsedMessage;
  resultTimestamp: Date;
  durationMs: number;
}

export interface GroupMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  messageCount: number;
}
```

### 2.6 Subagent (Task/subagent resolution)

Inspired by claude-devtools' `SubagentResolver`. Handles both NEW and OLD subagent directory structures.

```typescript
// Resolved subagent process
export interface Subagent {
  id: string;                          // Agent ID (from filename: agent-{id}.jsonl)
  filePath: string;                    // Path to subagent JSONL file
  messages: ParsedMessage[];           // Parsed messages from subagent file
  
  // Timing
  startTime: Date;
  endTime: Date;
  durationMs: number;
  
  // Metrics
  metrics: SubagentMetrics;
  
  // Linking
  parentTaskId?: string;               // ID of Task tool call that spawned this
  description?: string;                // Task description
  subagentType?: string;               // Subagent type (Explore, etc.)
  
  // Parallelism
  isParallel: boolean;                 // true if running in parallel with other subagents
  isOngoing: boolean;                  // true if still running
  
  // Team metadata (for team spawns)
  team?: {
    teamName: string;
    memberName: string;
    memberColor: string;
  };
}

export interface SubagentMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  messageCount: number;
  durationMs: number;
}
```

### 2.7 Session Metadata (from SQLite `sessions` + `turns` tables)

```typescript
// Matches session-report.md Section 4.1 (Session Overview table)
// NOTE: model comes from turns table (sessions table does NOT have model column)
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
  
  // Session state
  isOngoing: boolean;            // true if session is still active
  gitBranch?: string;            // Git branch from JSONL
  
  // Context consumption (across compaction phases)
  contextConsumption?: number;   // Total tokens used across all phases
  compactionCount?: number;      // Number of compaction events
  phaseBreakdown?: PhaseTokenBreakdown[]; // Per-phase token contribution
}

// Per-phase token breakdown (for compaction tracking)
export interface PhaseTokenBreakdown {
  phaseNumber: number;
  contribution: number;          // Tokens added in this phase
  peakTokens: number;            // Peak tokens before compaction
  postCompaction?: number;       // Tokens after compaction
}
```

### 2.8 Pricing Types

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
  cacheCreation5mCost: number;
  cacheCreation1hCost: number;
  totalCost: number;
}

// Full session pricing summary
export interface SessionPricing {
  totalCost: number;
  turnsPricing: TurnPricing[];
  pricingRate: PricingRate;
}
```

### 2.9 Full Timeline Output (merged JSON)

```typescript
// Final output of the extractor
export interface FullTimelineSession {
  session: SessionMetadata;
  turns: Turn[];
  subagents: Subagent[];           // All resolved subagents
  conversationGroups: ConversationGroup[]; // Grouped by user message
  pricing: SessionPricing;
}
```

### Key References:
- Token types: `session-report.md` Section 2.1, 2.2
- SQLite schemas: `session-report.md` Section 3.3.2 (turns table), 3.3.1 (sessions table)
- JSONL structure: `session-report.md` Section 3.3.4
- ParsedMessage fields: [claude-devtools types](https://github.com/matt1398/claude-devtools/blob/main/src/main/types/)
- Subagent resolution: [claude-devtools SubagentResolver](https://github.com/matt1398/claude-devtools/blob/main/src/main/services/discovery/SubagentResolver.ts)
- Conversation grouping: [claude-devtools ConversationGroupBuilder](https://github.com/matt1398/claude-devtools/blob/main/src/main/services/analysis/ConversationGroupBuilder.ts)

---

