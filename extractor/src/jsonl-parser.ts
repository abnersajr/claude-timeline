import { existsSync, readFileSync } from "node:fs"
import { deduplicateByRequestId } from "./dedup"
import { isDisplayableEntry } from "./noise-filter"
import type { RawJsonlRecord, ToolCall } from "./types"

/** Result of parsing a JSONL session file */
export interface JsonlParseResult {
  rawMessages: RawJsonlRecord[]
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

    // Filter noise
    if (!isDisplayableEntry(entry)) continue

    const record = entry as unknown as RawJsonlRecord
    rawMessages.push(record)

    // Normalize cache creation breakdown from JSONL
    if (record.message?.usage?.cache_creation) {
      const cc = record.message.usage.cache_creation
      record.message.usage.cacheCreation5mTokens = cc.ephemeral_5m_input_tokens ?? 0
      record.message.usage.cacheCreation1hTokens = cc.ephemeral_1h_input_tokens ?? 0
    }

    // Extract tool calls from assistant messages
    if (record.type === "assistant" && record.message?.content && Array.isArray(record.message.content)) {
      const indices: number[] = []
      for (const block of record.message.content) {
        if (block.type === "tool_use") {
          const idx = toolCalls.length
          toolCalls.push({
            toolUseId: (block.id ?? block.toolUseId) as string,
            name: block.name as string,
            input: block.input as Record<string, unknown>,
            timestamp: record.timestamp,
          })
          indices.push(idx)
        }
      }
      if (indices.length > 0 && record.uuid) {
        assistantToolCallIndices.set(record.uuid, indices)
      }
    }

    // Match toolUseResult to tool calls via parentUuid → uuid relationship
    if (record.toolUseResult && record.parentUuid) {
      const indices = assistantToolCallIndices.get(record.parentUuid)
      if (indices) {
        const result = record.toolUseResult as Record<string, unknown>
        // Extract meaningful result content
        let resultStr: string
        if (result.stdout !== undefined) {
          resultStr = String(result.stdout)
          if (result.stderr) resultStr += `\n[stderr]: ${result.stderr}`
        } else if (result.questions !== undefined) {
          resultStr = JSON.stringify({ questions: result.questions, answers: result.answers })
        } else {
          resultStr = JSON.stringify(result)
        }

        const isError = Boolean(result.interrupted) || Boolean(result.stderr)

        // Attach result to all tool calls from the parent assistant message
        for (const idx of indices) {
          toolCalls[idx].result = resultStr
          toolCalls[idx].isError = isError
        }
      }
    }
  }

  return {
    rawMessages: deduplicateByRequestId(rawMessages),
    toolCalls,
    malformedCount,
  }
}
