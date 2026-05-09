import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Get the path to usage.db
 * Priority: customPath > CLAUDE_CONFIG_DIR env > ~/.claude
 */
export function getDbPath(customPath?: string): string {
  if (customPath) return customPath
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")
  return join(configDir, "usage.db")
}

/**
 * Get the path to the projects directory
 * Priority: customPath > CLAUDE_CONFIG_DIR env > ~/.claude
 */
export function getProjectsDir(customPath?: string): string {
  if (customPath) return customPath
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")
  return join(configDir, "projects")
}

/**
 * Encode project name for directory lookup
 * Replaces all '/' with '-' (e.g., '/Users/test' → '-Users-test')
 */
export function encodeProjectName(projectName: string): string {
  return projectName.replaceAll("/", "-")
}

/**
 * Resolve the path to a session's JSONL file
 * Tries encoded project name first, then URL-encoded fallback
 */
export function resolveSessionJsonlPath(
  session: { projectName: string; sessionId: string },
  projectsDir: string,
): string | null {
  const encoded = encodeProjectName(session.projectName)
  const primaryPath = join(projectsDir, encoded, `${session.sessionId}.jsonl`)
  if (existsSync(primaryPath)) return primaryPath

  const urlEncoded = encodeURIComponent(session.projectName)
  const fallbackPath = join(projectsDir, urlEncoded, `${session.sessionId}.jsonl`)
  if (existsSync(fallbackPath)) return fallbackPath

  return null
}
