import { readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { getDbPath, getProjectsDir } from "@claude-timeline/extractor/utils"

export interface Config {
  port: number
  corsOrigins: string[]
  dbPath: string
  projectsDir: string
  costStreamDbPath: string
  costMethod: "api" | "estimated" | "auto"
}

const CONFIG_FILE = join(import.meta.dirname ?? process.cwd(), "..", "config.json")

function loadJsonConfig(): Partial<{
  port: number
  corsOrigins: string[]
  dbPath: string | null
  projectsDir: string | null
  costStreamDbPath: string | null
  costMethod: "api" | "estimated" | "auto"
}> {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8")
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function loadDashConfig(): Partial<{ costStreamDbPath: string; costMethod: string }> {
  try {
    const raw = readFileSync(join(homedir(), ".claude-dash", "config.json"), "utf-8")
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export function loadConfig(): Config {
  const file = loadJsonConfig()
  const dash = loadDashConfig()

  // Env vars override config.json; config.json overrides extractor defaults
  const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : file.port ?? 3001

  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
    : file.corsOrigins ?? ["https://claude-dash.local", "http://localhost:5199"]

  const dbPath = process.env.CLAUDE_DB_PATH ?? file.dbPath ?? getDbPath()
  const projectsDir = process.env.CLAUDE_PROJECTS_DIR ?? file.projectsDir ?? getProjectsDir()

  // costStreamDbPath: env > local config > dash config > default
  const costStreamDbPath = process.env.COST_STREAM_DB_PATH
    ?? file.costStreamDbPath
    ?? dash.costStreamDbPath
    ?? join(homedir(), ".claude-timeline", "cost-stream.db")

  // costMethod: env > dash config > local config > default
  const costMethod = (process.env.COST_METHOD as Config["costMethod"])
    ?? (dash.costMethod as Config["costMethod"])
    ?? file.costMethod
    ?? "auto"

  return { port, corsOrigins, dbPath, projectsDir, costStreamDbPath, costMethod }
}
