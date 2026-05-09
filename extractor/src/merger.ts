import { getSession, getTurns } from "./db-reader"
import { parseSessionJsonl } from "./jsonl-parser"
import { calculateSessionCost } from "./pricing"
import type { FullTimelineSession, Message, MessageContent, RawJsonlRecord, Turn } from "./types"
import { resolveSessionJsonlPath } from "./utils"

/**
 * Match SQLite turns to JSONL messages by timestamp.
 * Primary: timestamp within 5 seconds.
 * Fallback: index-based matching.
 * Each message is matched to at most one turn (closest timestamp wins).
 */
export function matchTurnsToMessages(turns: Turn[], messages: RawJsonlRecord[]): Turn[] {
  if (messages.length === 0) return turns

  // Track which messages have been matched
  const matchedIndices = new Set<number>()

  const matched = turns.map((turn, _turnIndex) => {
    const turnTime = new Date(turn.timestamp).getTime()
    const matchedMessages: RawJsonlRecord[] = []

    // Find closest unmatched message within 5 seconds
    let bestIndex = -1
    let bestDiff = Number.MAX_VALUE

    for (let i = 0; i < messages.length; i++) {
      if (matchedIndices.has(i)) continue
      const msg = messages[i]
      if (!msg.timestamp) continue
      const msgTime = new Date(msg.timestamp).getTime()
      const diff = Math.abs(turnTime - msgTime)
      if (diff < 5000 && diff < bestDiff) {
        bestDiff = diff
        bestIndex = i
      }
    }

    if (bestIndex >= 0) {
      matchedMessages.push(messages[bestIndex])
      matchedIndices.add(bestIndex)
    }

    // Fallback: index-based matching (use first unmatched)
    if (matchedMessages.length === 0) {
      for (let i = 0; i < messages.length; i++) {
        if (!matchedIndices.has(i)) {
          matchedMessages.push(messages[i])
          matchedIndices.add(i)
          break
        }
      }
    }

    // Convert RawJsonlRecord to Message
    const normalizedMessages: Message[] = matchedMessages.map((m) => ({
      type: (m.type as "assistant" | "user" | "system") ?? "assistant",
      timestamp: m.timestamp,
      content: normalizeContent(m.message?.content ?? []),
    }))

    return { ...turn, messages: normalizedMessages }
  })

  return matched
}

/**
 * Normalize content blocks to MessageContent[]
 */
function normalizeContent(content: Array<Record<string, unknown>>): MessageContent[] {
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
        toolUseId: String(block.toolUseId ?? ""),
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

  // 3. Match turns to messages
  const matchedTurns = matchTurnsToMessages(turns, jsonlResult?.rawMessages ?? [])

  // 4. Infer cache read types
  const enrichedTurns = matchedTurns.map((turn, i) => ({
    ...turn,
    cacheReadType: inferCacheReadType(i, matchedTurns, turn.timestamp),
  }))

  // 5. Calculate pricing
  const pricing = calculateSessionCost(session, enrichedTurns)

  return {
    session,
    turns: enrichedTurns,
    pricing,
  }
}
