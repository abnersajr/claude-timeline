import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { encodeProjectName } from "./utils"
import type { SubagentFile } from "./types"

/**
 * List subagent files for a session.
 * Scans two directory structures:
 * - New nested: {projectsDir}/{project}/{session}/subagents/agent-{id}.jsonl
 * - Legacy flat: {projectsDir}/{project}/agent-{id}.jsonl (filtered by sessionId)
 *
 * Returns NEW structure files first, then legacy flat files.
 */
export function listSubagentFiles(
  projectsDir: string,
  projectName: string,
  sessionId: string,
): SubagentFile[] {
  const encodedProject = encodeProjectName(projectName)
  const allFiles: SubagentFile[] = []

  // Try both encoded name and with leading '-' (Claude Code uses '-' prefix for paths)
  const candidates = [encodedProject]
  if (!encodedProject.startsWith("-")) {
    candidates.push(`-${encodedProject}`)
  }

  for (const projectDirName of candidates) {
    // 1. Scan NEW nested structure: {project}/{session}/subagents/agent-*.jsonl
    const newSubagentsDir = join(projectsDir, projectDirName, sessionId, "subagents")
    if (existsSync(newSubagentsDir)) {
      try {
        const entries = readdirSync(newSubagentsDir)
        for (const entry of entries) {
          if (entry.startsWith("agent-") && entry.endsWith(".jsonl")) {
            const agentId = extractAgentId(entry)
            if (agentId) {
              allFiles.push({
                filePath: join(newSubagentsDir, entry),
                agentId,
                isNewStructure: true,
              })
            }
          }
        }
      } catch {
        // Ignore directory read errors
      }
    }

    // 2. Scan legacy flat structure: {project}/agent-*.jsonl
    const projectDir = join(projectsDir, projectDirName)
    if (existsSync(projectDir)) {
      try {
        const entries = readdirSync(projectDir)
        for (const entry of entries) {
          if (entry.startsWith("agent-") && entry.endsWith(".jsonl")) {
            const agentId = extractAgentId(entry)
            if (!agentId) continue

            // Skip compact agents
            if (isCompactAgent(agentId)) continue

            // Legacy files are in project root — must filter by sessionId
            const filePath = join(projectDir, entry)
            if (subagentBelongsToSession(filePath, sessionId)) {
              allFiles.push({
                filePath,
                agentId,
                isNewStructure: false,
              })
            }
          }
        }
      } catch {
        // Ignore directory read errors
      }
    }
  }

  return allFiles
}

/**
 * Check if a session has any subagent files.
 * Fast check — returns true if at least one subagent file exists.
 */
export function hasSubagents(
  projectsDir: string,
  projectName: string,
  sessionId: string,
): boolean {
  const encodedProject = encodeProjectName(projectName)

  // Try both encoded name and with leading '-'
  const candidates = [encodedProject]
  if (!encodedProject.startsWith("-")) {
    candidates.push(`-${encodedProject}`)
  }

  for (const projectDirName of candidates) {
    // Check NEW nested structure first
    const newSubagentsDir = join(projectsDir, projectDirName, sessionId, "subagents")
    if (existsSync(newSubagentsDir)) {
      try {
        const entries = readdirSync(newSubagentsDir)
        for (const entry of entries) {
          if (entry.startsWith("agent-") && entry.endsWith(".jsonl")) {
            const filePath = join(newSubagentsDir, entry)
            const stat = readFileSync(filePath, "utf-8")
            if (stat.trim().length > 0) return true
          }
        }
      } catch {
        // Ignore errors
      }
    }

    // Check legacy flat structure
    const projectDir = join(projectsDir, projectDirName)
    if (existsSync(projectDir)) {
      try {
        const entries = readdirSync(projectDir)
        for (const entry of entries) {
          if (entry.startsWith("agent-") && entry.endsWith(".jsonl")) {
            const agentId = extractAgentId(entry)
            if (!agentId || isCompactAgent(agentId)) continue

            const filePath = join(projectDir, entry)
            if (subagentBelongsToSession(filePath, sessionId)) {
              return true
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }
  }

  return false
}

/**
 * Extract agent ID from filename.
 * e.g., "agent-abc123.jsonl" → "abc123"
 */
export function extractAgentId(filename: string): string | null {
  const name = basename(filename)
  const match = name.match(/^agent-([^.]+)\.jsonl$/)
  return match ? match[1] : null
}

/**
 * Check if agent ID belongs to a compact agent (starts with "acompact").
 */
export function isCompactAgent(agentId: string): boolean {
  return agentId.startsWith("acompact")
}

/**
 * Check if a legacy subagent file belongs to a specific session.
 * Reads the first line to check the sessionId field.
 */
export function subagentBelongsToSession(filePath: string, sessionId: string): boolean {
  try {
    const content = readFileSync(filePath, "utf-8")
    const firstNewline = content.indexOf("\n")
    const firstLine = firstNewline > 0 ? content.slice(0, firstNewline) : content

    if (!firstLine.trim()) return false

    const entry = JSON.parse(firstLine) as { sessionId?: string }
    return entry.sessionId === sessionId
  } catch {
    return false
  }
}
