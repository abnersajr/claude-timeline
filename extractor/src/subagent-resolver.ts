import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import type { RawJsonlRecord, Subagent } from "./types"

/**
 * Discover subagent files in a project directory.
 * Returns array of file paths matching agent-*.jsonl pattern.
 */
export function discoverSubagentFiles(projectsDir: string, projectName: string): string[] {
  const encodedProject = projectName.replace(/\//g, "-")
  const projectDir = join(projectsDir, encodedProject)

  if (!existsSync(projectDir)) return []

  try {
    const files = readdirSync(projectDir)
    return files
      .filter((f) => f.startsWith("agent-") && f.endsWith(".jsonl"))
      .map((f) => join(projectDir, f))
  } catch {
    return []
  }
}

/**
 * Parse a subagent JSONL file.
 * Returns raw messages or null if file doesn't exist.
 */
export function parseSubagentFile(filePath: string): RawJsonlRecord[] | null {
  if (!existsSync(filePath)) return null

  try {
    const content = readFileSync(filePath, "utf-8")
    const lines = content.split("\n").filter((line) => line.trim().length > 0)

    const records: RawJsonlRecord[] = []
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as RawJsonlRecord
        records.push(entry)
      } catch {
        // Skip malformed lines
      }
    }

    return records
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
 * Check if a subagent is a compact agent.
 * Compact agents have ID starting with "acompact".
 */
export function isCompactAgent(agentId: string): boolean {
  return agentId.startsWith("acompact")
}

/**
 * Extract agent ID from subagent file path.
 * e.g., '/.../agent-abc123.jsonl' → 'abc123'
 */
export function extractAgentId(filePath: string): string | null {
  const name = basename(filePath)
  const match = name.match(/^agent-([^.]+)\.jsonl$/)
  return match ? match[1] : null
}

/**
 * Resolve subagent sessions from discovered files.
 * Links subagents to parent Task calls via agentId matching.
 */
export function resolveSubagents(
  subagentFiles: string[],
  parentToolCalls: Array<{
    toolUseId: string
    name: string
    input: Record<string, unknown>
    result?: string
    timestamp?: string
  }>,
): Subagent[] {
  const subagents: Subagent[] = []

  for (const filePath of subagentFiles) {
    const agentId = extractAgentId(filePath)
    if (!agentId) continue

    // Skip compact agents
    if (isCompactAgent(agentId)) continue

    const records = parseSubagentFile(filePath)
    if (!records || records.length === 0) continue

    // Skip warmup agents
    if (isWarmupAgent(records)) continue

    // Find start and end timestamps
    const timestamps = records
      .filter((r) => r.timestamp)
      .map((r) => new Date(r.timestamp ?? "").getTime())
      .filter((t) => !Number.isNaN(t))

    const startTime = timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : ""
    const endTime = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : ""

    // Count turns (assistant messages)
    const turnCount = records.filter((r) => r.type === "assistant").length

    // Find description from first assistant message content
    const firstAssistant = records.find((r) => r.type === "assistant" && r.message?.content)
    let description = ""
    if (firstAssistant?.message?.content && Array.isArray(firstAssistant.message.content)) {
      const textBlock = firstAssistant.message.content.find((b) => b.type === "text")
      if (textBlock?.text) {
        description = String(textBlock.text).slice(0, 200)
      }
    }

    // Match to parent Task call via agentId
    let parentTaskId = ""
    for (const tc of parentToolCalls) {
      if (tc.name === "Task" && tc.result) {
        try {
          const resultObj = JSON.parse(tc.result)
          if (resultObj.agentId === agentId) {
            parentTaskId = tc.toolUseId
            break
          }
        } catch {
          // Result might not be JSON
        }
      }
    }

    subagents.push({
      id: agentId,
      parentTaskId,
      description,
      startTime,
      endTime,
      turnCount,
      status: "completed",
      isParallel: false,
    })
  }

  // Detect parallel execution (100ms overlap window)
  for (let i = 0; i < subagents.length; i++) {
    for (let j = i + 1; j < subagents.length; j++) {
      const a = subagents[i]
      const b = subagents[j]

      if (!a.startTime || !b.startTime || !a.endTime || !b.endTime) continue

      const aStart = new Date(a.startTime).getTime()
      const aEnd = new Date(a.endTime).getTime()
      const bStart = new Date(b.startTime).getTime()
      const bEnd = new Date(b.endTime).getTime()

      // Check for overlap (within 100ms window)
      if (aStart <= bEnd + 100 && bStart <= aEnd + 100) {
        a.isParallel = true
        b.isParallel = true
      }
    }
  }

  // Sort by startTime
  return subagents.sort((a, b) => {
    if (!a.startTime) return 1
    if (!b.startTime) return -1
    return a.startTime.localeCompare(b.startTime)
  })
}
