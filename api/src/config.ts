import { readFileSync } from "node:fs"
import { join } from "node:path"
import { getDbPath, getProjectsDir } from "@timeline/extractor/utils"

export interface Config {
  port: number
  corsOrigins: string[]
  dbPath: string
  projectsDir: string
}

const CONFIG_FILE = join(import.meta.dirname ?? process.cwd(), "..", "config.json")

function loadJsonConfig(): Partial<{
  port: number
  corsOrigins: string[]
  dbPath: string | null
  projectsDir: string | null
}> {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8")
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export function loadConfig(): Config {
  const file = loadJsonConfig()

  // Env vars override config.json; config.json overrides extractor defaults
  const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : file.port ?? 3001

  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
    : file.corsOrigins ?? ["https://claude-dash.local", "http://localhost:5199"]

  const dbPath = process.env.CLAUDE_DB_PATH ?? file.dbPath ?? getDbPath()
  const projectsDir = process.env.CLAUDE_PROJECTS_DIR ?? file.projectsDir ?? getProjectsDir()

  return { port, corsOrigins, dbPath, projectsDir }
}
