import { buildConversationGroups } from "./conversation-groups"
import { computeContextStats } from "./context-tracker"
import { getSession, getTurns } from "./db-reader"
import { parseSessionJsonl } from "./jsonl-parser"
import { classifyMessage } from "./classifier"
import { calculateSessionCost } from "./pricing"
import { detectSessionState } from "./session-state"
import { listSubagentFiles } from "./subagent-locator"
import { resolveSubagents } from "./subagent-resolver"
import type { FullTimelineSession, Message, MessageContent, RawJsonlRecord, Turn } from "./types"
import { resolveSessionJsonlPath } from "./utils"

/**
 * Match SQLite turns to JSONL messages and tool calls by timestamp.
 * Primary: timestamp within 5 seconds.
 * Fallback: index-based matching.
 * Each message/tool call is matched to at most one turn (closest timestamp wins).
 */
export function matchTurnsToMessages(
  turns: Turn[],
  messages: RawJsonlRecord[],
  toolCalls?: import("./types.js").ToolCall[],
): Turn[] {
  if (messages.length === 0 && (!toolCalls || toolCalls.length === 0)) return turns

  // Pre-pass: separate user text records from others
  const USER_TEXT_WINDOW = 10000 // 10 seconds for user text
  const OTHER_WINDOW = 5000     // 5 seconds for assistant/tool records

  const userIdxSet = new Set<number>()
  const otherIdxSet = new Set<number>()
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (!m.timestamp) {
      otherIdxSet.add(i)
      continue
    }
    const category = classifyMessage(m)
    if (category === "user") {
      userIdxSet.add(i)
    } else if (category !== "hardNoise") {
      otherIdxSet.add(i)
    }
    // hardNoise records are excluded from matching entirely
  }

  // Track which messages have been matched (both pools share this set)
  const matchedMsgIndices = new Set<number>()
  // Track which tool calls have been matched
  const matchedTcIndices = new Set<number>()

  const matched = turns.map((turn) => {
    const turnTime = new Date(turn.timestamp).getTime()
    const matchedMessages: RawJsonlRecord[] = []
    const matchedToolCalls: import("./types.js").ToolCall[] = []

    // Pass 1: Try to match a user text record within expanded window (10s)
    let bestUserIndex = -1
    let bestUserDiff = Number.MAX_VALUE
    for (const i of userIdxSet) {
      if (matchedMsgIndices.has(i)) continue
      const msg = messages[i]
      if (!msg.timestamp) continue
      const msgTime = new Date(msg.timestamp).getTime()
      const diff = Math.abs(turnTime - msgTime)
      if (diff < USER_TEXT_WINDOW && diff < bestUserDiff) {
        bestUserDiff = diff
        bestUserIndex = i
      }
    }
    if (bestUserIndex >= 0) {
      matchedMessages.push(messages[bestUserIndex])
      matchedMsgIndices.add(bestUserIndex)
    }

    // Pass 2: Try to match other records (assistant, tool_result, etc.) within 5s
    let bestOtherIndex = -1
    let bestOtherDiff = Number.MAX_VALUE
    for (const i of otherIdxSet) {
      if (matchedMsgIndices.has(i)) continue
      const msg = messages[i]
      if (!msg.timestamp) continue
      const msgTime = new Date(msg.timestamp).getTime()
      const diff = Math.abs(turnTime - msgTime)
      if (diff < OTHER_WINDOW && diff < bestOtherDiff) {
        bestOtherDiff = diff
        bestOtherIndex = i
      }
    }
    if (bestOtherIndex >= 0) {
      matchedMessages.push(messages[bestOtherIndex])
      matchedMsgIndices.add(bestOtherIndex)
    }

    // Fallback: index-based matching (use first unmatched non-noise record)
    if (matchedMessages.length === 0) {
      for (let i = 0; i < messages.length; i++) {
        if (!matchedMsgIndices.has(i) && otherIdxSet.has(i)) {
          matchedMessages.push(messages[i])
          matchedMsgIndices.add(i)
          break
        }
      }
      // If still nothing, try any unmatched non-noise record
      if (matchedMessages.length === 0) {
        for (let i = 0; i < messages.length; i++) {
          if (!matchedMsgIndices.has(i)) {
            matchedMessages.push(messages[i])
            matchedMsgIndices.add(i)
            break
          }
        }
      }
    }

    // Match tool calls by timestamp within 5 seconds
    if (toolCalls) {
      for (let i = 0; i < toolCalls.length; i++) {
        if (matchedTcIndices.has(i)) continue
        const tc = toolCalls[i]
        if (!tc.timestamp) continue
        const tcTime = new Date(tc.timestamp).getTime()
        if (Math.abs(turnTime - tcTime) < 5000) {
          matchedToolCalls.push(tc)
          matchedTcIndices.add(i)
        }
      }
    }

    // Convert RawJsonlRecord to Message
    const normalizedMessages: Message[] = matchedMessages.map((m) => {
      const category = classifyMessage(m)
      return {
        type: category === "user" ? "user" : "assistant",
        timestamp: m.timestamp,
        content: normalizeContent(m.message?.content ?? []),
      }
    })

    // Apply JSONL cache breakdown if available (preferred over DB total)
    let mergedTokenUsage = turn.tokenUsage
    for (const msg of matchedMessages) {
      const usage = msg.message?.usage
      if (usage?.cacheCreation5mTokens !== undefined || usage?.cacheCreation1hTokens !== undefined) {
        mergedTokenUsage = {
          ...turn.tokenUsage,
          cacheCreation5mTokens: usage.cacheCreation5mTokens ?? turn.tokenUsage.cacheCreation5mTokens,
          cacheCreation1hTokens: usage.cacheCreation1hTokens ?? turn.tokenUsage.cacheCreation1hTokens,
        }
        break
      }
    }

    // Extract model from first assistant message in matched messages
    let turnModel: string | undefined
    for (const msg of matchedMessages) {
      if (msg.type === "assistant" && msg.message?.model) {
        turnModel = msg.message.model
        break
      }
    }

    return {
      ...turn,
      model: turnModel,
      messages: normalizedMessages,
      toolCalls: matchedToolCalls,
      tokenUsage: mergedTokenUsage,
    }
  })

  // Collect any unmatched user text records and create synthetic turns for them
  const unmatchedUserTexts: RawJsonlRecord[] = []
  for (const i of userIdxSet) {
    if (!matchedMsgIndices.has(i)) {
      unmatchedUserTexts.push(messages[i])
    }
  }

  if (unmatchedUserTexts.length === 0) return matched

  // Create synthetic turns for unmatched user text
  const syntheticTurns: Turn[] = unmatchedUserTexts.map((r) => ({
    timestamp: r.timestamp!,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
    },
    messages: [
      {
        type: "user" as const,
        timestamp: r.timestamp,
        content: normalizeContent(r.message?.content ?? []),
      },
    ],
    toolCalls: [],
    cacheWriteType: "none" as const,
    cacheReadType: "unknown" as const,
    cacheCreationTokensThisTurn: 0,
  }))

  // Merge and sort by timestamp
  const allTurns = [...matched, ...syntheticTurns].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  )

  return allTurns
}

/**
 * Normalize content blocks to MessageContent[]
 */
function normalizeContent(content: Array<Record<string, unknown>> | string): MessageContent[] {
  if (typeof content === "string") {
    return [{ type: "text" as const, text: content }]
  }
  return content
    .filter((block) => {
      // Skip thinking blocks — they're internal model reasoning, not user-facing content
      if (block.type === "thinking") return false
      return true
    })
    .map((block) => {
      const type = block.type as string
      if (type === "text") {
        return { type: "text" as const, text: String(block.text ?? "") }
      }
      if (type === "tool_use") {
        return {
          type: "tool_use" as const,
          name: String(block.name ?? ""),
          input: (block.input as Record<string, unknown>) ?? {},
          toolUseId: String(block.id ?? block.toolUseId ?? ""),
        }
      }
      if (type === "tool_result") {
        return {
          type: "tool_result" as const,
          toolUseId: String(block.toolUseId ?? ""),
          content: block.content ?? "",
          isError: block.isError as boolean | undefined,
        }
      }
      // Fallback to text
      return { type: "text" as const, text: JSON.stringify(block) }
    })
}

/**
 * Infer cache read type based on timing between turns.
 * Default: 5m (most common TTL).
 */
export function inferCacheReadType(
  turnIndex: number,
  turns: Array<{ timestamp: string; cacheWriteType: string }>,
  currentTurnTime: string,
): "5m" | "1h" | "unknown" {
  try {
    if (turnIndex === 0) return "5m"

    const currentTime = new Date(currentTurnTime).getTime()
    if (Number.isNaN(currentTime)) return "unknown"

    const prevTurn = turns[turnIndex - 1]
    const prevTime = new Date(prevTurn.timestamp).getTime()
    if (Number.isNaN(prevTime)) return "unknown"

    const timeDiff = currentTime - prevTime

    if (prevTurn.cacheWriteType === "1h" && timeDiff < 60 * 60 * 1000) return "1h"
    if (prevTurn.cacheWriteType === "5m" && timeDiff < 5 * 60 * 1000) return "5m"

    return "5m"
  } catch {
    return "unknown"
  }
}

/**
 * Extract commandExecuted from the first user message.
 * Looks for <command-name>/...</command-name> tags in content.
 */
export function extractCommandExecuted(messages: RawJsonlRecord[]): string | undefined {
  const firstUser = messages.find((m) => m.type === "user")
  if (!firstUser) return undefined

  const content = firstUser.message?.content
  if (typeof content !== "string") return undefined

  const match = content.match(/<command-name>([\s\S]*?)<\/command-name>/)
  return match?.[1]?.trim() || undefined
}

/**
 * Extract full timeline for a session by merging SQLite and JSONL data.
 */
export async function extractFullTimeline(
  sessionId: string,
  dbPath: string,
  projectsDir: string,
): Promise<FullTimelineSession> {
  // 1. Get SQLite data
  const session = getSession(dbPath, sessionId)
  const turns = getTurns(dbPath, sessionId)

  // 2. Find and parse JSONL
  const jsonlPath = resolveSessionJsonlPath(session, projectsDir)
  const jsonlResult = parseSessionJsonl(jsonlPath, sessionId)

  // 3. Match turns to messages and tool calls
  const matchedTurns = matchTurnsToMessages(
    turns,
    jsonlResult?.rawMessages ?? [],
    jsonlResult?.toolCalls,
  )

  // 4. Infer cache read types
  const enrichedTurns = matchedTurns.map((turn, i) => ({
    ...turn,
    cacheReadType: inferCacheReadType(i, matchedTurns, turn.timestamp),
  }))

  // 5. Calculate pricing
  const pricing = calculateSessionCost(session, enrichedTurns)

  // 6. Compute context stats from raw JSONL records
  const contextStats = computeContextStats(jsonlResult?.rawMessages ?? [])

  // 7. Extract command executed from JSONL
  const commandExecuted = extractCommandExecuted(jsonlResult?.rawMessages ?? [])

  // 8. Detect session state (ongoing vs completed)
  const { isOngoing } = detectSessionState(jsonlResult?.rawMessages ?? [])

  // 9. Resolve subagents (discover files, parse, link to Task calls)
  const subagentFiles = listSubagentFiles(projectsDir, session.projectName, sessionId)
  const subagents = resolveSubagents(subagentFiles, jsonlResult?.toolCalls ?? [])

  // 10. Build conversation groups from enriched turns
  const conversationGroups = buildConversationGroups(enrichedTurns)

  return {
    session: { ...session, commandExecuted, isOngoing },
    turns: enrichedTurns,
    pricing,
    contextStats,
    ...(subagents.length > 0 ? { subagents } : {}),
    ...(conversationGroups.length > 0 ? { conversationGroups } : {}),
  }
}
