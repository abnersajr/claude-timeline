import { existsSync, readFileSync } from "node:fs"
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

    // Extract tool calls from assistant messages
    if (record.type === "assistant" && record.message?.content) {
      for (const block of record.message.content) {
        if (block.type === "tool_use") {
          toolCalls.push({
            toolUseId: block.toolUseId as string,
            name: block.name as string,
            input: block.input as Record<string, unknown>,
            timestamp: record.timestamp,
          })
        }
      }
    }

    // Match toolUseResult to existing toolCall
    if (record.toolUseResult) {
      const existing = toolCalls.find((tc) => tc.toolUseId === record.toolUseResult?.toolUseId)
      if (existing) {
        existing.result = String(record.toolUseResult.content)
        existing.isError = record.toolUseResult.isError
      }
    }
  }

  return { rawMessages, toolCalls, malformedCount }
}
