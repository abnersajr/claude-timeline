import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import cors from "cors"
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { getDbPath, getProjectsDir } from "@claude-timeline/extractor/utils"
import { listSessions, listJsonlSessions } from "@claude-timeline/extractor/db-reader"
import { extractFullTimeline, extractJsonlTimeline } from "@claude-timeline/extractor/merger"

interface Config {
  port: number
  corsOrigins: string[]
  dbPath: string
  projectsDir: string
  costStreamDbPath: string
  costMethod: "api" | "estimated" | "auto"
}

function loadConfig(): Config {
  const port = Number(process.env.PORT) || 5199
  const dbPath = process.env.CLAUDE_DB_PATH || getDbPath()
  const projectsDir = process.env.CLAUDE_PROJECTS_DIR || getProjectsDir()
  const costStreamDbPath = process.env.COST_STREAM_DB_PATH
    || path.join(process.env.HOME || "~", ".claude-timeline", "cost-stream.db")
  return {
    port,
    corsOrigins: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
      : ["http://localhost:5199", "http://localhost:3001"],
    dbPath, projectsDir, costStreamDbPath,
    costMethod: (process.env.COST_METHOD as Config["costMethod"]) || "estimated",
  }
}

function mountApiRoutes(app: express.Express, config: Config): void {
  const TIMELINE_DIR = path.join(homedir(), ".claude-timeline")
  const CONFIG_PATH = path.join(TIMELINE_DIR, "config.json")
  const CLAUDE_SETTINGS_PATH = path.join(homedir(), ".claude", "settings.json")

  function isStatuslineInstalled(): boolean {
    const capturePath = path.join(TIMELINE_DIR, "capture.js")
    if (!existsSync(capturePath)) return false
    try {
      const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf-8"))
      const cmd = settings.statusLine?.command as string | undefined
      return typeof cmd === "string" && cmd.includes("capture.js")
    } catch {
      return false
    }
  }

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: "1.0.0" })
  })

  app.get("/api/status", async (_req, res) => {
    const dbExists = existsSync(config.costStreamDbPath)
    const statuslineActive = isStatuslineInstalled()
    let sessionCount = 0

    if (dbExists) {
      try {
        const { CostStreamDb } = await import(
          "@claude-timeline/extractor/cost-stream-db" as string
        )
        const db = new CostStreamDb(config.costStreamDbPath)
        sessionCount = db.getSessionIds().length
        db.close()
      } catch (err) {
        console.error("[status] cost-stream-db import/query failed:", err)
      }
    }

    res.json({
      costCapture: {
        installed: statuslineActive,
        dbExists,
        dbPath: config.costStreamDbPath,
        sessionCount,
      },
      costMethod: config.costMethod,
    })
  })

  app.put("/api/settings", (req, res) => {
    const costMethod = req.body?.costMethod
    if (!["api", "estimated", "auto"].includes(costMethod)) {
      res.status(400).json({ error: "invalid_settings", message: "costMethod must be api, estimated, or auto" })
      return
    }

    // Read existing config
    let existingConfig: Record<string, unknown> = {}
    try {
      if (existsSync(CONFIG_PATH)) {
        existingConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"))
      }
    } catch { /* first run */ }

    existingConfig.costMethod = costMethod

    try {
      if (!existsSync(TIMELINE_DIR)) mkdirSync(TIMELINE_DIR, { recursive: true })
      writeFileSync(CONFIG_PATH, JSON.stringify(existingConfig, null, 2) + "\n")
    } catch {
      res.status(500).json({ error: "write_failed", message: "Failed to save settings" })
      return
    }

    res.json({ costMethod })
  })

  if (!existsSync(config.dbPath)) {
    console.warn(
      `[warn] usage.db not found at ${config.dbPath} — Claude Code may not have run yet, or uses an older version. Falling back to JSONL files only.`,
    )
  }

  app.get("/api/sessions", async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 20
      const dbSessions = listSessions(config.dbPath, limit)
      const jsonlSessions = listJsonlSessions(config.projectsDir, config.dbPath, limit)
      const seen = new Set(dbSessions.map((s) => s.sessionId))
      const merged = [...dbSessions]
      for (const s of jsonlSessions) {
        if (!seen.has(s.sessionId)) { merged.push(s); seen.add(s.sessionId) }
      }
      merged.sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp))
      res.json(merged)
    } catch (err) {
      console.error("[sessions]", err)
      res.status(500).json({ error: "failed_to_list_sessions" })
    }
  })

  app.get("/api/sessions/:id", async (req, res) => {
    try {
      const sessionId = req.params.id
      let data
      try {
        data = await extractFullTimeline(sessionId, config.dbPath, config.projectsDir)
      } catch (err: unknown) {
        if ((err as { code?: number }).code === 2) {
          const fs = await import("node:fs")
          const p = await import("node:path")
          for (const dir of fs.readdirSync(config.projectsDir)) {
            const candidate = p.join(config.projectsDir, dir, sessionId + ".jsonl")
            if (fs.existsSync(candidate)) {
              data = await extractJsonlTimeline(sessionId, config.projectsDir, candidate)
              break
            }
          }
          if (!data) { res.status(404).json({ error: "session_not_found" }); return }
        } else { throw err }
      }
      res.json(data)
    } catch (err) {
      console.error("[session]", err)
      res.status(500).json({ error: "failed_to_extract_session" })
    }
  })

  app.post("/api/sessions/:id/refresh", async (req, res) => {
    try {
      const sessionId = req.params.id
      let data
      try {
        data = await extractFullTimeline(sessionId, config.dbPath, config.projectsDir)
      } catch (err: unknown) {
        if ((err as { code?: number }).code === 2) {
          const fs = await import("node:fs")
          const p = await import("node:path")
          for (const dir of fs.readdirSync(config.projectsDir)) {
            const candidate = p.join(config.projectsDir, dir, sessionId + ".jsonl")
            if (fs.existsSync(candidate)) {
              data = await extractJsonlTimeline(sessionId, config.projectsDir, candidate)
              break
            }
          }
        } else { throw err }
      }
      if (!data) { res.status(404).json({ error: "session_not_found" }); return }
      res.json(data)
    } catch (err) {
      console.error("[refresh]", err)
      res.status(500).json({ error: "failed_to_refresh_session" })
    }
  })
}

async function main() {
  const config = loadConfig()
  const app = express()

  app.use(cors({ origin: config.corsOrigins }))
  app.use(express.json())

  mountApiRoutes(app, config)

  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const webDir = path.join(__dirname, "web")

  app.use(express.static(webDir))
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(webDir, "index.html"))
  })

  app.listen(config.port)
}

main().catch((err) => {
  console.error("Failed to start:", err)
  process.exit(1)
})
