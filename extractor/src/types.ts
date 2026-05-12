/** Message category from the 5-category cascade */
export type MessageCategory = "user" | "assistant" | "system" | "compact" | "hardNoise"

/** A message paired with its classified category */
export interface ClassifiedMessage {
  record: RawJsonlRecord
  category: MessageCategory
}

/** Per-turn token counts */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreation5mTokens: number
  cacheCreation1hTokens: number
  /** Fallback total cache creation (optional) */
  cacheCreationTokens?: number
}

/** Raw JSONL record from session file (internal use) */
export interface RawJsonlRecord {
  type: string
  timestamp?: string
  uuid?: string
  parentUuid?: string
  requestId?: string
  isMeta?: boolean
  isSidechain?: boolean
  isCompactSummary?: boolean
  agentId?: string
  sourceToolUseID?: string
  message?: {
    role: string
    content: Array<Record<string, unknown>> | string
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
      cache_creation?: {
        ephemeral_5m_input_tokens?: number
        ephemeral_1h_input_tokens?: number
      }
      // Normalized fields (populated by parser)
      cacheCreation5mTokens?: number
      cacheCreation1hTokens?: number
    }
  }
  toolUseResult?: {
    toolUseId: string
    content: unknown
    isError?: boolean
  }
}

/** Text content block */
export interface TextContent {
  type: "text"
  text: string
}

/** Tool use content block */
export interface ToolUseContent {
  type: "tool_use"
  name: string
  input: Record<string, unknown>
  toolUseId: string
}

/** Tool result content block */
export interface ToolResultContent {
  type: "tool_result"
  toolUseId: string
  content: unknown
  isError?: boolean
}

/** Union of all message content types */
export type MessageContent = TextContent | ToolUseContent | ToolResultContent

/** Normalized message */
export interface Message {
  type: "assistant" | "user" | "system"
  timestamp?: string
  content: MessageContent[]
}

/** Extracted tool invocation */
export interface ToolCall {
  toolUseId: string
  name: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
  timestamp?: string
  /** Whether this tool call is a Task (subagent spawn) */
  isTask: boolean
  /** Description of the task, extracted from Task tool input */
  taskDescription?: string
  /** Subagent type, extracted from Task tool input */
  taskSubagentType?: string
}

/** Single API call record */
export interface Turn {
  timestamp: string
  tokenUsage: TokenUsage
  toolName?: string
  cwd?: string
  /** Model used for this specific turn (detected from assistant message). Falls back to session-level model when undefined. */
  model?: string
  messages: Message[]
  toolCalls: ToolCall[]
  cacheWriteType: "5m" | "1h" | "none"
  cacheReadType: "5m" | "1h" | "5m-fallback" | "unknown"
  cacheCreationTokensThisTurn: number
}

/** Session-level info from SQLite */
export interface SessionMetadata {
  sessionId: string
  projectName: string
  model: string
  commandExecuted?: string
  workingDirectory: string
  turnCount: number
  totalTokens: TokenUsage
  startTime: string
  endTime: string
  isOngoing: boolean
  activeDurationMs?: number
  costCaptureAvailable?: boolean   // true if cost-stream.db has data for this session
}

/** Model pricing config */
export interface PricingRate {
  model: string
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheCreation5mPerMTok: number
  cacheCreation1hPerMTok: number
}

/** Per-turn cost breakdown */
export interface TurnPricing {
  inputCost: number
  outputCost: number
  cacheReadCost: number
  cacheCreation5mCost: number
  cacheCreation1hCost: number
  totalCost: number
}

/** Session-level pricing */
export interface SessionPricing {
  // ── Estimated stream (always available, from JSONL × pricing rates) ──
  estimatedTotalCost: number       // JSONL tokens × pricing rates
  turnsPricing: TurnPricing[]      // per-turn breakdown (always from estimated)

  // ── API stream (when cost-capture is active) ──
  apiTotalCost: number | null      // from cost-stream.db (null = not available)
  apiSnapshotCount: number         // how many snapshots were captured
  apiLastSnapshotAt: string | null // last snapshot timestamp

  // ── Preferred (based on global setting) ──
  totalCost: number                // the "primary" display value
  costSource: "api" | "estimated"  // which stream is primary

  // ── Shared ──
  pricingRate: PricingRate
}

/** Matched tool call with result and timing */
export interface ToolExecution {
  toolCall: ToolCall
  result?: string
  isError?: boolean
  durationMs: number
  startTime: string
  endTime: string
}

/** Discovered subagent file */
export interface SubagentFile {
  /** Absolute path to the JSONL file */
  filePath: string
  /** Agent ID extracted from filename (e.g., "abc123" from "agent-abc123.jsonl") */
  agentId: string
  /** Whether this file is from the NEW nested structure */
  isNewStructure: boolean
}

/** Subagent session */
export interface Subagent {
  id: string
  parentTaskId: string
  description: string
  startTime: string
  endTime: string
  turnCount: number
  status: "completed" | "failed" | "pending"
  isParallel: boolean
  /** Model used by the subagent */
  model?: string
  /** Aggregated token usage (request-id deduplicated) */
  totalTokens?: TokenUsage
  /** Messages from the subagent session */
  messages?: Message[]
  /** Tool calls from the subagent session */
  toolCalls?: ToolCall[]
}

/** Conversation group: user message + all AI responses until next user message */
export interface ConversationGroup {
  id: string
  userMessage?: Message
  aiResponses: Message[]
  toolExecutions: ToolCall[]
  processIds: string[]
  startTime: string
  endTime: string
  durationMs: number
  tokenUsage: TokenUsage
  totalCost: number
}

/** Final output shape */
export interface FullTimelineSession {
  session: SessionMetadata
  turns: Turn[]
  pricing: SessionPricing
  contextStats?: ContextStats
  subagents?: Subagent[]
  conversationGroups?: ConversationGroup[]
}

// ─── Context Tracking Types ──────────────────────────────────────────

/** Context categories for token tracking */
export type ContextCategory =
  | "user-message"
  | "tool-output"
  | "thinking-text"
  | "system"
  | "compact"
  | "other"

/** A compaction phase in the session (bounded by compact events) */
export interface Phase {
  phaseNumber: number
  startRecordIndex: number
  endRecordIndex: number
}

/** A single context injection record tracking what consumed tokens */
export interface ContextInjection {
  recordIndex: number
  category: ContextCategory
  inputTokens: number
  timestamp?: string
  phaseNumber: number
}

/** Per-turn context snapshot */
export interface TurnContextSnapshot {
  recordIndex: number
  category: ContextCategory
  inputTokens: number
  phaseNumber: number
  timestamp?: string
}

/** Session-level context statistics */
export interface ContextStats {
  injections: ContextInjection[]
  tokensByCategory: Record<ContextCategory, number>
  totalInputTokens: number
  phaseCount: number
  phases: Phase[]
}
