import type { ToolCall, ToolExecution } from "./types"

/**
 * Match tool calls to their results and compute timing.
 *
 * @param toolCalls - Tool calls extracted from JSONL
 * @param toolResults - Tool results extracted from JSONL (keyed by toolUseId)
 * @returns Array of ToolExecution sorted by startTime
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
      try {
        const start = new Date(startTime).getTime()
        const end = new Date(endTime).getTime()
        durationMs = Math.max(0, end - start)
      } catch {
        durationMs = 0
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
 * Tool results are in user messages with parentUuid matching assistant message uuid.
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
    if (msg.type !== "user" || !msg.toolUseResult || !msg.parentUuid) continue

    const result = msg.toolUseResult as Record<string, unknown>
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

    resultMap.set(msg.parentUuid, {
      result: resultStr,
      isError,
      timestamp: msg.timestamp || "",
    })
  }

  return resultMap
}
