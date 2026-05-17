import type { ConversationGroup, Message, TokenUsage, ToolCall, Turn } from "./types"

/**
 * Build conversation groups from a flat list of turns.
 *
 * Grouping strategy: scan turns in order. Each turn containing a user message
 * starts a new group. All subsequent turns (AI-only) belong to that group
 * until the next user turn. Orphaned AI-only sequences at the start are
 * collected into their own group.
 */
export function buildConversationGroups(turns: Turn[]): ConversationGroup[] {
  if (turns.length === 0) return []

  const groups: ConversationGroup[] = []
  let currentGroup: ConversationGroup | null = null

  for (const turn of turns) {
    const hasUserMessage = turn.messages.some((m) => m.type === "user")

    if (hasUserMessage) {
      // Finalize previous group if any
      if (currentGroup) {
        groups.push(finalizeGroup(currentGroup))
      }

      // Extract the first user message for this group
      const userMessage = turn.messages.find((m) => m.type === "user")

      currentGroup = {
        id: `group-${groups.length + 1}`,
        userMessage,
        aiResponses: [],
        toolExecutions: [],
        processIds: [],
        startTime: turn.timestamp,
        endTime: turn.timestamp,
        durationMs: 0,
        tokenUsage: emptyTokenUsage(),
        totalCost: 0,
      }

      // Process tool calls from the user turn (e.g. Task calls)
      collectToolCalls(currentGroup, turn)

      // Aggregate user turn token usage
      currentGroup.tokenUsage.inputTokens += turn.tokenUsage.inputTokens
      currentGroup.tokenUsage.outputTokens += turn.tokenUsage.outputTokens
      currentGroup.tokenUsage.cacheReadTokens += turn.tokenUsage.cacheReadTokens
      currentGroup.tokenUsage.cacheCreation5mTokens += turn.tokenUsage.cacheCreation5mTokens
      currentGroup.tokenUsage.cacheCreation1hTokens += turn.tokenUsage.cacheCreation1hTokens
    } else if (currentGroup) {
      // AI-only turn belonging to current group
      appendTurnToGroup(currentGroup, turn)
    } else {
      // Orphaned AI turn before any user message — start an orphan group
      currentGroup = {
        id: `group-${groups.length + 1}`,
        userMessage: undefined,
        aiResponses: [],
        toolExecutions: [],
        processIds: [],
        startTime: turn.timestamp,
        endTime: turn.timestamp,
        durationMs: 0,
        tokenUsage: emptyTokenUsage(),
        totalCost: 0,
      }
      appendTurnToGroup(currentGroup, turn)
    }
  }

  // Finalize last group
  if (currentGroup) {
    groups.push(finalizeGroup(currentGroup))
  }

  return groups
}

/** Append an AI turn's data into the current group. */
function appendTurnToGroup(group: ConversationGroup, turn: Turn): void {
  // Collect all messages as AI responses
  for (const msg of turn.messages) {
    group.aiResponses.push(msg)
  }

  collectToolCalls(group, turn)

  // Aggregate token usage
  group.tokenUsage.inputTokens += turn.tokenUsage.inputTokens
  group.tokenUsage.outputTokens += turn.tokenUsage.outputTokens
  group.tokenUsage.cacheReadTokens += turn.tokenUsage.cacheReadTokens
  group.tokenUsage.cacheCreation5mTokens += turn.tokenUsage.cacheCreation5mTokens
  group.tokenUsage.cacheCreation1hTokens += turn.tokenUsage.cacheCreation1hTokens

  // Update end time
  group.endTime = turn.timestamp
}

/** Collect tool executions and process IDs from a turn's tool calls. */
function collectToolCalls(group: ConversationGroup, turn: Turn): void {
  for (const tc of turn.toolCalls) {
    group.toolExecutions.push(tc)
    if (tc.isTask) {
      group.processIds.push(tc.toolUseId)
    }
  }
}

/** Finalize a group: aggregate token usage, compute duration, set cost to 0. */
function finalizeGroup(group: ConversationGroup): ConversationGroup {
  // Note: tokenUsage aggregation happens externally if needed per-turn.
  // For now, we store zeroed usage — the pricing module computes costs later.
  const start = new Date(group.startTime).getTime()
  const end = new Date(group.endTime).getTime()
  group.durationMs = Number.isFinite(start) && Number.isFinite(end) ? end - start : 0
  group.totalCost = 0
  return group
}

/** Create a zeroed TokenUsage object. */
function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
  }
}
