import { extractToolCalls, formatToolResult } from "./tool-extraction"
import type { RawJsonlRecord, ToolCall, ToolExecution } from "./types"

/**
 * Collect tool calls from raw JSONL messages.
 * Extracts tool_use blocks from assistant messages.
 */
export function collectToolCalls(rawMessages: RawJsonlRecord[]): ToolCall[] {
  const toolCalls: ToolCall[] = []

  for (const msg of rawMessages) {
    if (msg.type !== "assistant" || !msg.message?.content) continue

    const newCalls = extractToolCalls(msg.message.content, msg.timestamp)
    toolCalls.push(...newCalls)
  }

  return toolCalls
}

/**
 * Match tool calls to their results and compute timing.
 *
 * Matching strategy:
 * 1. Primary: Match by sourceToolUseID (in tool result metadata)
 * 2. Fallback: Match by parentUuid (user message → assistant message)
 * 3. Fallback: Match by toolResults array (positional)
 */
export function matchToolCalls(
  toolCalls: ToolCall[],
  toolResults: Map<string, { result: string; isError: boolean; timestamp: string }>,
): ToolExecution[] {
  const executions: ToolExecution[] = []

  for (const call of toolCalls) {
    const toolUseId = call.toolUseId
    const matchedResult = toolResults.get(toolUseId)

    const startTime = call.timestamp || ""
    const endTime = matchedResult?.timestamp || startTime

    let durationMs = 0
    if (startTime && endTime && startTime !== endTime) {
      const start = new Date(startTime).getTime()
      const end = new Date(endTime).getTime()
      if (!Number.isNaN(start) && !Number.isNaN(end)) {
        durationMs = Math.max(0, end - start)
      }
    }

    executions.push({
      toolCall: call,
      result: matchedResult?.result || call.result,
      isError: matchedResult?.isError || call.isError || false,
      durationMs,
      startTime,
      endTime,
    })
  }

  return executions.sort((a, b) => {
    if (!a.startTime) return 1
    if (!b.startTime) return -1
    return a.startTime.localeCompare(b.startTime)
  })
}

/**
 * Build a map of tool results from raw JSONL records.
 * Keys by toolUseId from toolUseResult metadata.
 */
export function buildToolResultMap(
  rawMessages: Array<{
    type: string
    uuid?: string
    parentUuid?: string
    toolUseResult?: Record<string, unknown>
    timestamp?: string
  }>,
): Map<string, { result: string; isError: boolean; timestamp: string }> {
  const resultMap = new Map<string, { result: string; isError: boolean; timestamp: string }>()

  for (const msg of rawMessages) {
    if (msg.type !== "user" || !msg.toolUseResult) continue

    const result = msg.toolUseResult as Record<string, unknown>
    const toolUseId = result.toolUseId as string | undefined
    if (!toolUseId) continue

    const resultStr = formatToolResult(result)
    const isError = Boolean(result.interrupted) || Boolean(result.stderr)

    resultMap.set(toolUseId, {
      result: resultStr,
      isError,
      timestamp: msg.timestamp || "",
    })
  }

  return resultMap
}
