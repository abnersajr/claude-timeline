import type { ToolCall } from "./types"

/**
 * Extract tool calls from assistant message content.
 * Filters tool_use blocks and identifies Task tools specially.
 */
export function extractToolCalls(
  content: Array<Record<string, unknown>> | string,
  timestamp?: string,
): ToolCall[] {
  if (typeof content === "string") return []
  if (!Array.isArray(content)) return []

  const calls: ToolCall[] = []
  for (const block of content) {
    if (block.type !== "tool_use") continue

    const toolUseId = String(block.id ?? block.toolUseId ?? "")
    const name = String(block.name ?? "")
    const input = (block.input as Record<string, unknown>) ?? {}

    // Identify Task tool (subagent spawn)
    const isTask = name === "Task"
    let taskDescription: string | undefined
    let taskSubagentType: string | undefined

    if (isTask && input) {
      taskDescription = typeof input.description === "string" ? input.description : undefined
      taskSubagentType = typeof input.subagent_type === "string" ? input.subagent_type : undefined
    }

    calls.push({
      toolUseId,
      name,
      input,
      timestamp,
      isTask,
      taskDescription,
      taskSubagentType,
    })
  }
  return calls
}

/**
 * Extract tool results from user message content.
 * Filters tool_result blocks from content array.
 */
export function extractToolResults(content: Array<Record<string, unknown>> | string): ToolResult[] {
  if (typeof content === "string") return []
  if (!Array.isArray(content)) return []

  const results: ToolResult[] = []
  for (const block of content) {
    if (block.type !== "tool_result") continue

    results.push({
      toolUseId: String(block.tool_use_id ?? block.toolUseId ?? ""),
      content: block.content,
      isError: Boolean(block.is_error) || Boolean(block.isError),
    })
  }
  return results
}

/**
 * Raw tool result extracted from message content.
 */
export interface ToolResult {
  toolUseId: string
  content: unknown
  isError?: boolean
}

/**
 * Link tool results to tool calls by toolUseId.
 * Sets result string and isError flag on matched calls.
 * Returns a new array (does not mutate input).
 */
export function linkToolResults(calls: ToolCall[], results: ToolResult[]): ToolCall[] {
  // Build a map from toolUseId to results
  const resultMap = new Map<string, ToolResult>()
  for (const result of results) {
    resultMap.set(result.toolUseId, result)
  }

  // Link results to calls
  return calls.map((call) => {
    const result = resultMap.get(call.toolUseId)
    if (!result) return call

    return {
      ...call,
      result: formatToolResult(result.content),
      isError: result.isError ?? call.isError,
    }
  })
}

/**
 * Format tool result content into a readable string.
 * Handles:
 * - stdout/stderr (command execution results)
 * - questions/answers (interactive prompts)
 * - generic JSON (everything else)
 */
export function formatToolResult(content: unknown): string {
  if (content === null || content === undefined) return ""
  if (typeof content === "string") return content

  // Handle object content
  if (typeof content === "object" && !Array.isArray(content)) {
    const obj = content as Record<string, unknown>

    // Command execution results with stdout/stderr
    if ("stdout" in obj) {
      let result = String(obj.stdout ?? "")
      if (obj.stderr) {
        result += `\n[stderr]: ${obj.stderr}`
      }
      return result
    }

    // Interactive prompt results with questions/answers
    if ("questions" in obj) {
      return JSON.stringify({ questions: obj.questions, answers: obj.answers })
    }

    // Generic JSON fallback
    return JSON.stringify(content)
  }

  // Array or other types
  return JSON.stringify(content)
}
