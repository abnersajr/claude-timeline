import { existsSync, readFileSync } from "node:fs"
import { classifyMessage } from "./classifier"
import { deduplicateByRequestId } from "./dedup"
import {
  extractToolCalls,
  extractToolResults,
  formatToolResult,
  linkToolResults,
} from "./tool-extraction"
import type { MessageCategory, RawJsonlRecord, ToolCall } from "./types"

/** Result of parsing a JSONL session file */
export interface JsonlParseResult {
  rawMessages: RawJsonlRecord[]
  categories: MessageCategory[]
  toolCalls: ToolCall[]
  malformedCount: number
}

/**
 * Parse a JSONL session file into raw messages and tool calls.
 * Returns null if file doesn't exist or path is null.
 */
export function parseSessionJsonl(
  jsonlPath: string | null,
  _sessionId: string,
): JsonlParseResult | null {
  if (!jsonlPath || !existsSync(jsonlPath)) return null

  const content = readFileSync(jsonlPath, "utf-8")
  const lines = content.split("\n").filter((line) => line.trim().length > 0)

  const rawMessages: RawJsonlRecord[] = []
  const toolCalls: ToolCall[] = []
  let malformedCount = 0

  // Map: assistant uuid → indices into toolCalls array
  const assistantToolCallIndices = new Map<string, number[]>()

  for (const line of lines) {
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line)
    } catch {
      malformedCount++
      continue
    }

    const record = entry as unknown as RawJsonlRecord

    // Classify and filter hard noise
    const category = classifyMessage(record)
    if (category === "hardNoise") continue

    rawMessages.push(record)

    // Normalize cache creation breakdown from JSONL
    if (record.message?.usage?.cache_creation) {
      const cc = record.message.usage.cache_creation
      record.message.usage.cacheCreation5mTokens = cc.ephemeral_5m_input_tokens ?? 0
      record.message.usage.cacheCreation1hTokens = cc.ephemeral_1h_input_tokens ?? 0
    }

    // Extract tool calls from assistant messages
    if (record.type === "assistant" && record.message?.content) {
      const newCalls = extractToolCalls(record.message.content, record.timestamp)
      const startIdx = toolCalls.length
      toolCalls.push(...newCalls)

      if (newCalls.length > 0 && record.uuid) {
        const indices = Array.from({ length: newCalls.length }, (_, i) => startIdx + i)
        assistantToolCallIndices.set(record.uuid, indices)
      }
    }

    // Extract tool results from user messages (meta messages with tool_result blocks)
    if (record.type === "user" && record.isMeta && record.message?.content) {
      const results = extractToolResults(record.message.content)
      if (results.length > 0) {
        // Link results to tool calls by toolUseId
        const updatedCalls = linkToolResults(toolCalls, results)
        // Update the toolCalls array with linked results
        for (let i = 0; i < updatedCalls.length; i++) {
          if (updatedCalls[i].result !== toolCalls[i].result) {
            toolCalls[i] = updatedCalls[i]
          }
        }
      }
    }

    // Match toolUseResult to tool calls via parentUuid → uuid relationship
    if (record.toolUseResult && record.parentUuid) {
      const indices = assistantToolCallIndices.get(record.parentUuid)
      if (indices) {
        const result = record.toolUseResult as Record<string, unknown>
        const resultStr = formatToolResult(result)
        const isError = Boolean(result.interrupted) || Boolean(result.stderr)

        // Attach result to all tool calls from the parent assistant message
        for (const idx of indices) {
          toolCalls[idx].result = resultStr
          toolCalls[idx].isError = isError
        }
      }
    }
  }

  const deduped = deduplicateByRequestId(rawMessages)
  const categories = deduped.map((r) => classifyMessage(r))

  return {
    rawMessages: deduped,
    categories,
    toolCalls,
    malformedCount,
  }
}
