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
  message?: {
    role: string
    content: Array<Record<string, unknown>>
    model?: string
    usage?: TokenUsage
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
}

/** Single API call record */
export interface Turn {
  timestamp: string
  tokenUsage: TokenUsage
  toolName?: string
  cwd?: string
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
  totalCost: number
  turnsPricing: TurnPricing[]
  pricingRate: PricingRate
}

/** Final output shape */
export interface FullTimelineSession {
  session: SessionMetadata
  turns: Turn[]
  pricing: SessionPricing
}
