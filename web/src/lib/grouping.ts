// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageRole = "user" | "assistant" | "tool" | "system"

export interface ToolCall {
  id: string
  name: string
  arguments: string
  result?: string
}

export interface TurnMessage {
  role: MessageRole
  content: string
  timestamp: string
  toolCalls?: ToolCall[]
}

export interface TokenUsage {
  prompt: number
  completion: number
  total: number
}

export interface ConversationGroup {
  id: string
  userMessage: TurnMessage
  responses: TurnMessage[]
  toolExecutions: ToolCall[]
  tokens: TokenUsage
  cost: number
  startedAt: string
  endedAt: string
}

// ---------------------------------------------------------------------------
// Transform raw turns into conversation groups
// ---------------------------------------------------------------------------

export function groupConversations(
  turns: Array<{
    id: string
    messages: TurnMessage[]
    tokens?: TokenUsage
    cost?: number
    started_at: string
    ended_at: string
  }>,
): ConversationGroup[] {
  const groups: ConversationGroup[] = []

  for (const turn of turns) {
    const userMessages = turn.messages.filter((m) => m.role === "user")
    const assistantMessages = turn.messages.filter(
      (m) => m.role === "assistant",
    )
    const toolMessages = turn.messages.filter((m) => m.role === "tool")

    const toolExecutions: ToolCall[] = []
    for (const msg of assistantMessages) {
      if (msg.toolCalls) {
        toolExecutions.push(...msg.toolCalls)
      }
    }

    for (const msg of toolMessages) {
      const existing = toolExecutions.find((tc) =>
        msg.content?.includes(tc.id),
      )
      if (!existing) {
        toolExecutions.push({
          id: `tool-${msg.timestamp}`,
          name: "tool_result",
          arguments: "",
          result: msg.content,
        })
      } else {
        existing.result = msg.content
      }
    }

    const userMessage = userMessages[0] ?? {
      role: "user" as const,
      content: "(no user message)",
      timestamp: turn.started_at,
    }

    groups.push({
      id: turn.id,
      userMessage,
      responses: assistantMessages,
      toolExecutions,
      tokens: turn.tokens ?? { prompt: 0, completion: 0, total: 0 },
      cost: turn.cost ?? 0,
      startedAt: turn.started_at,
      endedAt: turn.ended_at,
    })
  }

  return groups
}

// ---------------------------------------------------------------------------
// Helpers for display
// ---------------------------------------------------------------------------

export function truncateText(text: string, maxLen = 120): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + "..."
}

export function groupTokensSummary(group: ConversationGroup): string {
  const { prompt, completion } = group.tokens
  return `${prompt.toLocaleString()} in / ${completion.toLocaleString()} out`
}
