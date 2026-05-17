import { existsSync, readFileSync } from "node:fs"
import { deduplicateByRequestId } from "./dedup"
import {
  extractToolCalls,
  extractToolResults,
  linkToolResults,
} from "./tool-extraction"
import { calculateTurnCost, getPricing } from "./pricing"
import { normalizeModelName } from "./model-parser"
import type {
  Message,
  MessageContent,
  RawJsonlRecord,
  Subagent,
  SubagentFile,
  TokenUsage,
  ToolCall,
  Turn,
  TurnPricing,
} from "./types"

/**
 * Parallel detection window in milliseconds.
 * Subagents starting within this window are considered parallel.
 */
const PARALLEL_WINDOW_MS = 100

/**
 * Result of parsing a subagent JSONL file.
 */
interface SubagentParseResult {
  records: RawJsonlRecord[]
  messages: Message[]
  toolCalls: ToolCall[]
  description: string
  agentType?: string
  model?: string
  totalTokens: TokenUsage
}

/**
 * Resolve subagents from discovered files.
 * Links subagents to parent Task calls with 3-phase linking:
 *   Phase 1: agentId matching (from Task tool result JSON)
 *   Phase 2: description matching (fuzzy match on taskDescription)
 *   Phase 3: positional fallback (unmatched Task calls in order)
 *
 * Also detects parallel execution and aggregates tokens.
 */
export function resolveSubagents(
  subagentFiles: SubagentFile[],
  parentToolCalls: ToolCall[],
): Subagent[] {
  // Parse all subagent files
  const parsed: Array<{ file: SubagentFile; result: SubagentParseResult }> = []
  for (const file of subagentFiles) {
    const result = parseSubagentFile(file.filePath)
    if (!result) continue

    // Skip warmup subagents
    if (isWarmupAgent(result.records)) continue

    // Skip compact agents (safety check)
    if (file.agentId.startsWith("acompact")) continue

    parsed.push({ file, result })
  }

  // Get Task/Agent tool calls from parent (both "Task" and "Agent" named tools)
  const taskCalls = parentToolCalls.filter((tc) => tc.isTask || tc.name === "Agent")
  const unmatchedTaskCalls = [...taskCalls]

  const subagents: Subagent[] = []

  for (const { file, result } of parsed) {
    // Phase 1: Match by agentId from Task tool result
    let parentTaskId = ""
    let matchedTaskCall: ToolCall | undefined

    for (let i = 0; i < unmatchedTaskCalls.length; i++) {
      const tc = unmatchedTaskCalls[i]
      if (tc.result) {
        try {
          const resultObj = JSON.parse(tc.result) as { agentId?: string }
          if (resultObj.agentId === file.agentId) {
            parentTaskId = tc.toolUseId
            matchedTaskCall = tc
            unmatchedTaskCalls.splice(i, 1)
            break
          }
        } catch {
          // Result might not be JSON
        }
      }
    }

    // Phase 2: Match by description if no agentId match
    if (!parentTaskId && result.description) {
      for (let i = 0; i < unmatchedTaskCalls.length; i++) {
        const tc = unmatchedTaskCalls[i]
        if (tc.taskDescription) {
          const desc = result.description.toLowerCase()
          const taskDesc = tc.taskDescription.toLowerCase()
          if (desc.includes(taskDesc) || taskDesc.includes(desc)) {
            parentTaskId = tc.toolUseId
            matchedTaskCall = tc
            unmatchedTaskCalls.splice(i, 1)
            break
          }
        }
      }
    }

    // Phase 3: Positional fallback — assign next unmatched Task call
    if (!parentTaskId && unmatchedTaskCalls.length > 0) {
      const tc = unmatchedTaskCalls.shift()!
      parentTaskId = tc.toolUseId
      matchedTaskCall = tc
    }

    subagents.push({
      id: file.agentId,
      parentTaskId,
      description: result.description,
      startTime: result.records.length > 0 ? findStartTime(result.records) : "",
      endTime: result.records.length > 0 ? findEndTime(result.records) : "",
      turnCount: result.records.filter((r) => r.type === "assistant").length,
      status: "completed",
      isParallel: false,
      model: result.model,
      agentType: result.agentType,
      totalTokens: result.totalTokens,
      totalCost: computeSubagentCost(result.totalTokens, result.model),
      messages: result.messages,
      toolCalls: result.toolCalls,
    })
  }

  // Detect parallel execution (100ms overlap window)
  detectParallelExecution(subagents)

  // Sort by startTime
  return subagents.sort((a, b) => {
    if (!a.startTime) return 1
    if (!b.startTime) return -1
    return a.startTime.localeCompare(b.startTime)
  })
}

/**
 * Parse a subagent JSONL file into structured data.
 * Returns null if file doesn't exist or is empty.
 */
export function parseSubagentFile(filePath: string): SubagentParseResult | null {
  if (!existsSync(filePath)) return null

  try {
    const content = readFileSync(filePath, "utf-8")
    const lines = content.split("\n").filter((line) => line.trim().length > 0)

    if (lines.length === 0) return null

    const records: RawJsonlRecord[] = []
    let malformedCount = 0

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as RawJsonlRecord
        records.push(entry)
      } catch {
        malformedCount++
      }
    }

    if (records.length === 0) return null

    // Normalize cache creation breakdown from JSONL
    for (const record of records) {
      if (record.message?.usage?.cache_creation) {
        const cc = record.message.usage.cache_creation
        record.message.usage.cacheCreation5mTokens = cc.ephemeral_5m_input_tokens ?? 0
        record.message.usage.cacheCreation1hTokens = cc.ephemeral_1h_input_tokens ?? 0
      }
    }

    // Deduplicate by requestId (streaming artifact)
    const deduped = deduplicateByRequestId(records)

    // Extract tool calls
    const toolCalls: ToolCall[] = []
    const assistantToolCallIndices = new Map<string, number[]>()

    for (const record of deduped) {
      if (record.type === "assistant" && record.message?.content) {
        const newCalls = extractToolCalls(record.message.content, record.timestamp)
        const startIdx = toolCalls.length
        toolCalls.push(...newCalls)

        if (newCalls.length > 0 && record.uuid) {
          const indices = Array.from({ length: newCalls.length }, (_, i) => startIdx + i)
          assistantToolCallIndices.set(record.uuid, indices)
        }
      }

      // Extract tool results from user messages
      if (record.type === "user" && record.isMeta && record.message?.content) {
        const results = extractToolResults(record.message.content)
        if (results.length > 0) {
          const updatedCalls = linkToolResults(toolCalls, results)
          for (let i = 0; i < updatedCalls.length; i++) {
            if (updatedCalls[i].result !== toolCalls[i].result) {
              toolCalls[i] = updatedCalls[i]
            }
          }
        }
      }

      // Match toolUseResult via parentUuid
      if (record.toolUseResult && record.parentUuid) {
        const indices = assistantToolCallIndices.get(record.parentUuid)
        if (indices) {
          for (const idx of indices) {
            toolCalls[idx].result = JSON.stringify(record.toolUseResult)
          }
        }
      }
    }

    // Convert records to Messages
    const messages: Message[] = deduped.map((r) => ({
      type: (r.type as "assistant" | "user" | "system") ?? "assistant",
      timestamp: r.timestamp,
      content: normalizeContent(r.message?.content ?? []),
    }))

    // Extract model from first assistant message
    let model: string | undefined
    for (const record of deduped) {
      if (record.type === "assistant" && record.message?.model) {
        model = record.message.model
        break
      }
    }

    // Aggregate tokens with request-id dedup
    const totalTokens = aggregateTokens(deduped)

    // Extract description from first assistant text block
    let description = ""
    const firstAssistant = deduped.find(
      (r) => r.type === "assistant" && r.message?.content,
    )
    if (firstAssistant?.message?.content && Array.isArray(firstAssistant.message.content)) {
      const textBlock = firstAssistant.message.content.find(
        (b) => (b as Record<string, unknown>).type === "text",
      )
      if (textBlock && (textBlock as Record<string, unknown>).text) {
        description = String((textBlock as Record<string, unknown>).text).slice(0, 200)
      }
    }

    // Read meta.json for agentType and higher-quality description
    const metaPath = filePath.replace(/\.jsonl$/, ".meta.json")
    let agentType: string | undefined
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
          agentType?: string
          description?: string
        }
        agentType = meta.agentType
        // Prefer meta.json description (user-facing, higher quality)
        if (meta.description) {
          description = meta.description
        }
      } catch {
        // Malformed meta.json — use JSONL-extracted description
      }
    }

    return {
      records: deduped,
      messages,
      toolCalls,
      description,
      agentType,
      model,
      totalTokens,
    }
  } catch {
    return null
  }
}

/**
 * Check if a subagent is a warmup agent.
 * Warmup agents have first user message === "Warmup".
 */
export function isWarmupAgent(records: RawJsonlRecord[]): boolean {
  const firstUser = records.find((r) => r.type === "user")
  if (!firstUser) return false
  const content = firstUser.message?.content
  return typeof content === "string" && content === "Warmup"
}

/**
 * Find the earliest timestamp in records.
 */
function findStartTime(records: RawJsonlRecord[]): string {
  const timestamps = records
    .filter((r) => r.timestamp)
    .map((r) => new Date(r.timestamp ?? "").getTime())
    .filter((t) => !Number.isNaN(t))

  if (timestamps.length === 0) return ""
  return new Date(Math.min(...timestamps)).toISOString()
}

/**
 * Find the latest timestamp in records.
 */
function findEndTime(records: RawJsonlRecord[]): string {
  const timestamps = records
    .filter((r) => r.timestamp)
    .map((r) => new Date(r.timestamp ?? "").getTime())
    .filter((t) => !Number.isNaN(t))

  if (timestamps.length === 0) return ""
  return new Date(Math.max(...timestamps)).toISOString()
}

/**
 * Detect parallel execution among subagents.
 * Subagents are considered parallel if their time ranges overlap
 * within a 100ms window.
 */
function detectParallelExecution(subagents: Subagent[]): void {
  for (let i = 0; i < subagents.length; i++) {
    for (let j = i + 1; j < subagents.length; j++) {
      const a = subagents[i]
      const b = subagents[j]

      if (!a.startTime || !b.startTime || !a.endTime || !b.endTime) continue

      const aStart = new Date(a.startTime).getTime()
      const aEnd = new Date(a.endTime).getTime()
      const bStart = new Date(b.startTime).getTime()
      const bEnd = new Date(b.endTime).getTime()

      // Check for overlap within 100ms window
      if (aStart <= bEnd + PARALLEL_WINDOW_MS && bStart <= aEnd + PARALLEL_WINDOW_MS) {
        a.isParallel = true
        b.isParallel = true
      }
    }
  }
}

/**
 * Aggregate token usage across records with request-id dedup.
 * Same logic as dedup.ts: only the last entry per requestId counts.
 */
function aggregateTokens(records: RawJsonlRecord[]): TokenUsage {
  const totals: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
  }

  // Track best entry per requestId for assistant messages
  const bestByRequestId = new Map<string, { outputTokens: number; usage: TokenUsage }>()

  for (const record of records) {
    const usage = record.message?.usage
    if (!usage) continue

    const tokens: TokenUsage = {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreation5mTokens: usage.cacheCreation5mTokens ?? 0,
      cacheCreation1hTokens: usage.cacheCreation1hTokens ?? 0,
    }

    const rid = record.requestId

    // User/system messages without requestId: add directly
    if (!rid) {
      totals.inputTokens += tokens.inputTokens
      totals.outputTokens += tokens.outputTokens
      totals.cacheReadTokens += tokens.cacheReadTokens
      totals.cacheCreation5mTokens += tokens.cacheCreation5mTokens
      totals.cacheCreation1hTokens += tokens.cacheCreation1hTokens
      continue
    }

    // Assistant messages with requestId: keep best per requestId
    const existing = bestByRequestId.get(rid)
    if (!existing || tokens.outputTokens > existing.outputTokens) {
      bestByRequestId.set(rid, { outputTokens: tokens.outputTokens, usage: tokens })
    }
  }

  // Sum up deduplicated assistant tokens
  for (const { usage } of bestByRequestId.values()) {
    totals.inputTokens += usage.inputTokens
    totals.outputTokens += usage.outputTokens
    totals.cacheReadTokens += usage.cacheReadTokens
    totals.cacheCreation5mTokens += usage.cacheCreation5mTokens
    totals.cacheCreation1hTokens += usage.cacheCreation1hTokens
  }

  return totals
}

/**
 * Compute total cost for a subagent from aggregated tokens and model.
 * Uses a single synthetic Turn to calculate cost via the shared pricing logic.
 */
function computeSubagentCost(tokens: TokenUsage, model?: string): number {
  const rate = getPricing(normalizeModelName(model ?? ""))
  const syntheticTurn: Turn = {
    timestamp: new Date().toISOString(),
    tokenUsage: tokens,
    model,
    messages: [],
    toolCalls: [],
    cacheWriteType: "none",
    cacheReadType: "unknown",
    cacheCreationTokensThisTurn: 0,
  }
  const pricing: TurnPricing = calculateTurnCost(syntheticTurn, rate)
  return pricing.totalCost
}

/**
 * Normalize content blocks to MessageContent[].
 */
function normalizeContent(content: Array<Record<string, unknown>> | string): MessageContent[] {
  if (typeof content === "string") {
    return [{ type: "text" as const, text: content }]
  }
  if (!Array.isArray(content)) {
    return []
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
        toolUseId: String(block.tool_use_id ?? block.toolUseId ?? ""),
        content: block.content ?? "",
        isError: (block.is_error ?? block.isError) as boolean | undefined,
      }
    }
    return { type: "text" as const, text: JSON.stringify(block) }
  })
}

// Re-export locator functions for backward compatibility
export { extractAgentId, isCompactAgent } from "./subagent-locator"
