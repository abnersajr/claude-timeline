import { buildConversationGroups } from "./conversation-groups"
import { computeContextStats } from "./context-tracker"
import { getSession, getTurns, SessionNotFoundError } from "./db-reader"
import { parseSessionJsonl } from "./jsonl-parser"
import { classifyMessage } from "./classifier"
import { normalizeModelName } from "./model-parser"
import { calculateSessionCost } from "./pricing"
import { detectSessionState } from "./session-state"
import { listSubagentFiles } from "./subagent-locator"
import { resolveSubagents } from "./subagent-resolver"
import type {
  FullTimelineSession,
  Message,
  MessageContent,
  RawJsonlRecord,
  SessionMetadata,
  TokenUsage,
  Turn,
} from "./types"
import { resolveSessionJsonlPath } from "./utils"

/**
 * Compute active duration by summing gaps between consecutive turns
 * that are below a threshold (5 minutes). Large gaps represent idle/closed
 * sessions and are excluded.
 */
/** Check if a turn has actual content (not an empty noise record) */
function hasTurnContent(turn: Turn): boolean {
  const u = turn.tokenUsage
  if (u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheCreation5mTokens + u.cacheCreation1hTokens > 0) return true
  return turn.messages.some((m) => m.content.length > 0)
}

function computeActiveDurationMs(
  turns: Turn[],
  thresholdMs = 5 * 60 * 1000,
): number {
  const meaningful = turns.filter(hasTurnContent)
  if (meaningful.length < 2) return 0
  let activeMs = 0
  for (let i = 1; i < meaningful.length; i++) {
    const gap = new Date(meaningful[i].timestamp).getTime() - new Date(meaningful[i - 1].timestamp).getTime()
    if (gap > 0 && gap < thresholdMs) {
      activeMs += gap
    }
  }
  return activeMs
}

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

  // Pre-assign tool calls to their closest turn (one-to-one, no duplicates)
  const toolCallsByTurnIdx = new Map<number, import("./types.js").ToolCall[]>()
  if (toolCalls && toolCalls.length > 0) {
    const TC_WINDOW = 5000
    for (const tc of toolCalls) {
      if (!tc.timestamp) continue
      const tcTime = new Date(tc.timestamp).getTime()
      let bestIdx = -1
      let bestDiff = Number.MAX_VALUE
      for (let ti = 0; ti < turns.length; ti++) {
        const turnTime = new Date(turns[ti].timestamp).getTime()
        const diff = Math.abs(turnTime - tcTime)
        if (diff < bestDiff && diff < TC_WINDOW) {
          bestDiff = diff
          bestIdx = ti
        }
      }
      if (bestIdx >= 0) {
        let arr = toolCallsByTurnIdx.get(bestIdx)
        if (!arr) {
          arr = []
          toolCallsByTurnIdx.set(bestIdx, arr)
        }
        arr.push(tc)
      }
    }
  }

  const matched = turns.map((turn, turnIdx) => {
    const turnTime = new Date(turn.timestamp).getTime()
    const matchedMessages: RawJsonlRecord[] = []

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

    // Match tool calls by closest timestamp (assign each to its nearest turn)
    // Note: actual assignment is done post-loop via closestMatchToolCalls

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
      toolCalls: toolCallsByTurnIdx.get(turnIdx) ?? [],
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
          toolUseId: String(block.tool_use_id ?? block.toolUseId ?? ""),
          content: block.content ?? "",
          isError: (block.is_error ?? block.isError) as boolean | undefined,
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
  if (!session) {
    // DB doesn't exist or session not found — caller should fall back to JSONL-only
    throw new SessionNotFoundError(sessionId)
  }
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

  // 9b. Link each subagent to its parent turn index (for inline UI placement)
  for (const sub of subagents) {
    if (sub.parentTaskId) {
      for (let i = 0; i < enrichedTurns.length; i++) {
        if (enrichedTurns[i].toolCalls.some((tc) => tc.toolUseId === sub.parentTaskId)) {
          sub.parentTurnIndex = i
          break
        }
      }
    }
  }

  // 10. Build conversation groups from enriched turns
  const conversationGroups = buildConversationGroups(enrichedTurns)

  // 11. Compute active duration (excluding idle gaps > 5 min)
  const activeDurationMs = computeActiveDurationMs(enrichedTurns)

  // 12. Include agent costs in session total and modelBreakdown
  const agentTotalCost = subagents.reduce((sum, s) => sum + (s.totalCost ?? 0), 0)
  if (agentTotalCost > 0) {
    pricing.estimatedTotalCost += agentTotalCost
    pricing.totalCost = pricing.costSource === "api"
      ? pricing.apiTotalCost ?? pricing.estimatedTotalCost
      : pricing.estimatedTotalCost

    // Add agent costs to modelBreakdown
    for (const sub of subagents) {
      const model = normalizeModelName(sub.model ?? "unknown")
      if (!pricing.modelBreakdown[model]) {
        pricing.modelBreakdown[model] = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cost: 0,
          turnCount: 0,
        }
      }
      const entry = pricing.modelBreakdown[model]
      if (sub.totalTokens) {
        entry.inputTokens += sub.totalTokens.inputTokens
        entry.outputTokens += sub.totalTokens.outputTokens
        entry.cacheReadTokens += sub.totalTokens.cacheReadTokens
        entry.cacheCreationTokens += sub.totalTokens.cacheCreation5mTokens + sub.totalTokens.cacheCreation1hTokens
      }
      entry.cost += sub.totalCost ?? 0
      entry.turnCount += sub.turnCount
    }
  }

  return {
    session: { ...session, commandExecuted, isOngoing, activeDurationMs },
    turns: enrichedTurns,
    pricing,
    contextStats,
    ...(subagents.length > 0 ? { subagents } : {}),
    ...(conversationGroups.length > 0 ? { conversationGroups } : {}),
  }
}

/**
 * Build synthetic Turn[] from JSONL records when no SQLite turns exist.
 * Groups consecutive assistant messages into turns, each preceded by the
 * nearest user message.
 */
function buildTurnsFromJsonl(
  rawMessages: RawJsonlRecord[],
  toolCalls: import("./types.js").ToolCall[],
): Turn[] {
  const turns: Turn[] = []

  // Pre-build turn indices with timestamps for closest-match assignment
  const turnEntries: Array<{ index: number; timestamp: number }> = []
  for (let i = 0; i < rawMessages.length; i++) {
    const m = rawMessages[i]
    const category = classifyMessage(m)
    if (category !== "assistant" && category !== "user") continue
    if (!m.timestamp) continue
    turnEntries.push({ index: i, timestamp: new Date(m.timestamp).getTime() })
  }

  // Assign each tool call to its closest turn (one-to-one, no duplicates)
  const toolCallsByTurn = new Map<number, import("./types.js").ToolCall[]>()
  const MAX_TC_WINDOW = 5000
  for (const tc of toolCalls) {
    if (!tc.timestamp) continue
    const tcTime = new Date(tc.timestamp).getTime()
    let bestIdx = -1
    let bestDiff = Number.MAX_VALUE
    for (const entry of turnEntries) {
      const diff = Math.abs(entry.timestamp - tcTime)
      if (diff < bestDiff && diff < MAX_TC_WINDOW) {
        bestDiff = diff
        bestIdx = entry.index
      }
    }
    if (bestIdx >= 0) {
      let arr = toolCallsByTurn.get(bestIdx)
      if (!arr) {
        arr = []
        toolCallsByTurn.set(bestIdx, arr)
      }
      arr.push(tc)
    }
  }

  for (let i = 0; i < rawMessages.length; i++) {
    const m = rawMessages[i]
    const category = classifyMessage(m)
    if (category !== "assistant" && category !== "user") continue

    const matchedToolCalls = toolCallsByTurn.get(i) ?? []

    // Skip zero-token noise: no tools, no meaningful content
    const usage = m.message?.usage
    const totalTokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0) +
      (usage?.cache_read_input_tokens ?? 0) +
      (usage?.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
      (usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0)
    if (totalTokens === 0 && matchedToolCalls.length === 0) {
      const content = m.message?.content
      const hasMeaningfulContent = 
        (typeof content === 'string' && content.length > 0 && !content.includes('No response requested')) ||
        (Array.isArray(content) && content.some((b: Record<string, unknown>) => b.type === 'tool_use' || b.type === 'tool_result'))
      if (!hasMeaningfulContent) continue
    }

    const cc5m = usage?.cacheCreation5mTokens ?? usage?.cache_creation?.ephemeral_5m_input_tokens ?? 0
    const cc1h = usage?.cacheCreation1hTokens ?? usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0

    turns.push({
      timestamp: m.timestamp ?? new Date().toISOString(),
      tokenUsage: {
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
        cacheCreation5mTokens: cc5m,
        cacheCreation1hTokens: cc1h,
      },
      model: m.message?.model,
      messages: [
        {
          type: category === "user" ? "user" : "assistant",
          timestamp: m.timestamp,
          content: normalizeContent(m.message?.content ?? []),
        },
      ],
      toolCalls: matchedToolCalls,
      cacheWriteType: cc5m > 0 ? "5m" : cc1h > 0 ? "1h" : "none",
      cacheReadType: "unknown",
      cacheCreationTokensThisTurn: cc5m + cc1h,
    })
  }

  return turns.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  )
}

/**
 * Extract full timeline from JSONL only (no SQLite).
 * Used when a session exists on disk but hasn't been indexed into usage.db.
 */
export async function extractJsonlTimeline(
  sessionId: string,
  projectsDir: string,
  jsonlPath: string,
): Promise<FullTimelineSession> {
  const jsonlResult = parseSessionJsonl(jsonlPath, sessionId)
  const rawMessages = jsonlResult?.rawMessages ?? []

  // Detect session state
  const { isOngoing } = detectSessionState(rawMessages)

  // Extract model
  let model = "claude-sonnet-4-6"
  for (const m of rawMessages) {
    if (m.type === "assistant" && m.message?.model) {
      model = m.message.model
      break
    }
  }

  // Count user messages for turn count
  const turnCount = rawMessages.filter(
    (m) => m.type === "user" && !m.isMeta,
  ).length

  // Compute token totals
  const totalTokens: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
  }
  for (const m of rawMessages) {
    const u = m.message?.usage
    if (!u) continue
    totalTokens.inputTokens += u.input_tokens ?? 0
    totalTokens.outputTokens += u.output_tokens ?? 0
    totalTokens.cacheReadTokens += u.cache_read_input_tokens ?? 0
    const cc = u.cache_creation
    totalTokens.cacheCreation5mTokens +=
      u.cacheCreation5mTokens ?? cc?.ephemeral_5m_input_tokens ?? 0
    totalTokens.cacheCreation1hTokens +=
      u.cacheCreation1hTokens ?? cc?.ephemeral_1h_input_tokens ?? 0
  }

  // Derive project name from JSONL path
  // Path: {projectsDir}/{encodedProject}/{sessionId}.jsonl
  const pathParts = jsonlPath.replace(projectsDir, "").split("/").filter(Boolean)
  const encodedProject = pathParts[0] ?? "unknown"
  const projectName = encodedProject.startsWith("-")
    ? encodedProject.slice(1)
    : encodedProject

  // Build turns from JSONL
  const turns = buildTurnsFromJsonl(rawMessages, jsonlResult?.toolCalls ?? [])

  // Enrich with cache read types
  const enrichedTurns = turns.map((turn, i) => ({
    ...turn,
    cacheReadType: inferCacheReadType(i, turns, turn.timestamp),
  }))

  // Derive startTime/endTime from meaningful turns (exclude empty noise records)
  const meaningfulTurns = enrichedTurns.filter(hasTurnContent)
  const firstMeaningful = meaningfulTurns[0]
  const lastMeaningful = meaningfulTurns[meaningfulTurns.length - 1]
  const sessionStartTime = firstMeaningful?.timestamp ?? rawMessages[0]?.timestamp ?? new Date().toISOString()
  const sessionEndTime = lastMeaningful?.timestamp ?? rawMessages[rawMessages.length - 1]?.timestamp ?? new Date().toISOString()

  const session: SessionMetadata = {
    sessionId,
    projectName,
    model,
    workingDirectory: "",
    turnCount,
    totalTokens,
    startTime: sessionStartTime,
    endTime: sessionEndTime,
    isOngoing,
  }

  // Calculate pricing
  const pricing = calculateSessionCost(session, enrichedTurns)

  // Context stats
  const contextStats = computeContextStats(rawMessages)

  // Command executed
  const commandExecuted = extractCommandExecuted(rawMessages)

  // Subagents
  const subagentFiles = listSubagentFiles(projectsDir, projectName, sessionId)
  const subagents = resolveSubagents(subagentFiles, jsonlResult?.toolCalls ?? [])

  // Link each subagent to its parent turn index (for inline UI placement)
  for (const sub of subagents) {
    if (sub.parentTaskId) {
      for (let i = 0; i < enrichedTurns.length; i++) {
        if (enrichedTurns[i].toolCalls.some((tc) => tc.toolUseId === sub.parentTaskId)) {
          sub.parentTurnIndex = i
          break
        }
      }
    }
  }

  // Conversation groups
  const conversationGroups = buildConversationGroups(enrichedTurns)

  // Compute active duration (excluding idle gaps > 5 min)
  const activeDurationMs = computeActiveDurationMs(enrichedTurns)

  // Include agent costs in session total and modelBreakdown
  const agentTotalCost = subagents.reduce((sum, s) => sum + (s.totalCost ?? 0), 0)
  if (agentTotalCost > 0) {
    pricing.estimatedTotalCost += agentTotalCost
    pricing.totalCost = pricing.costSource === "api"
      ? pricing.apiTotalCost ?? pricing.estimatedTotalCost
      : pricing.estimatedTotalCost

    // Add agent costs to modelBreakdown
    for (const sub of subagents) {
      const model = normalizeModelName(sub.model ?? "unknown")
      if (!pricing.modelBreakdown[model]) {
        pricing.modelBreakdown[model] = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cost: 0,
          turnCount: 0,
        }
      }
      const entry = pricing.modelBreakdown[model]
      if (sub.totalTokens) {
        entry.inputTokens += sub.totalTokens.inputTokens
        entry.outputTokens += sub.totalTokens.outputTokens
        entry.cacheReadTokens += sub.totalTokens.cacheReadTokens
        entry.cacheCreationTokens += sub.totalTokens.cacheCreation5mTokens + sub.totalTokens.cacheCreation1hTokens
      }
      entry.cost += sub.totalCost ?? 0
      entry.turnCount += sub.turnCount
    }
  }

  return {
    session: { ...session, commandExecuted, isOngoing, activeDurationMs },
    turns: enrichedTurns,
    pricing,
    contextStats,
    ...(subagents.length > 0 ? { subagents } : {}),
    ...(conversationGroups.length > 0 ? { conversationGroups } : {}),
  }
}
