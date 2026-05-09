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
 * Tries multiple encodings to handle DB storing project_name with or without leading '/'
 */
export function resolveSessionJsonlPath(
  session: { projectName: string; sessionId: string },
  projectsDir: string,
): string | null {
  const candidates: string[] = []

  // Direct encoding of what's in the DB
  candidates.push(encodeProjectName(session.projectName))

  // If no leading '/', try with leading '/' (DB sometimes strips it)
  if (!session.projectName.startsWith("/")) {
    candidates.push(encodeProjectName(`/${session.projectName}`))
  }

  // If has leading '/', try without it
  if (session.projectName.startsWith("/")) {
    candidates.push(encodeProjectName(session.projectName.slice(1)))
  }

  // URL-encoded fallback
  candidates.push(encodeURIComponent(session.projectName))

  for (const encoded of candidates) {
    const filePath = join(projectsDir, encoded, `${session.sessionId}.jsonl`)
    if (existsSync(filePath)) return filePath
  }

  return null
}
