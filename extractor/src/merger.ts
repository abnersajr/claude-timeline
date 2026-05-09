import { getSession, getTurns } from "./db-reader"
import { parseSessionJsonl } from "./jsonl-parser"
import { calculateSessionCost } from "./pricing"
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

  // Track which messages have been matched
  const matchedMsgIndices = new Set<number>()
  // Track which tool calls have been matched
  const matchedTcIndices = new Set<number>()

  const matched = turns.map((turn) => {
    const turnTime = new Date(turn.timestamp).getTime()
    const matchedMessages: RawJsonlRecord[] = []
    const matchedToolCalls: import("./types.js").ToolCall[] = []

    // Find closest unmatched message within 5 seconds
    let bestMsgIndex = -1
    let bestMsgDiff = Number.MAX_VALUE

    for (let i = 0; i < messages.length; i++) {
      if (matchedMsgIndices.has(i)) continue
      const msg = messages[i]
      if (!msg.timestamp) continue
      const msgTime = new Date(msg.timestamp).getTime()
      const diff = Math.abs(turnTime - msgTime)
      if (diff < 5000 && diff < bestMsgDiff) {
        bestMsgDiff = diff
        bestMsgIndex = i
      }
    }

    if (bestMsgIndex >= 0) {
      matchedMessages.push(messages[bestMsgIndex])
      matchedMsgIndices.add(bestMsgIndex)
    }

    // Fallback: index-based matching (use first unmatched)
    if (matchedMessages.length === 0) {
      for (let i = 0; i < messages.length; i++) {
        if (!matchedMsgIndices.has(i)) {
          matchedMessages.push(messages[i])
          matchedMsgIndices.add(i)
          break
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
    const normalizedMessages: Message[] = matchedMessages.map((m) => ({
      type: (m.type as "assistant" | "user" | "system") ?? "assistant",
      timestamp: m.timestamp,
      content: normalizeContent(m.message?.content ?? []),
    }))

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

    return { ...turn, messages: normalizedMessages, toolCalls: matchedToolCalls, tokenUsage: mergedTokenUsage }
  })

  return matched
}

/**
 * Normalize content blocks to MessageContent[]
 */
function normalizeContent(content: Array<Record<string, unknown>> | string): MessageContent[] {
  if (typeof content === "string") {
    return [{ type: "text" as const, text: content }]
  }
  return content.map((block) => {
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

  // 6. Extract command executed from JSONL
  const commandExecuted = extractCommandExecuted(jsonlResult?.rawMessages ?? [])

  return {
    session: { ...session, commandExecuted },
    turns: enrichedTurns,
    pricing,
  }
}
