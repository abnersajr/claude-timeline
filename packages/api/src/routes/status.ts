import { Router } from "express"
import { z } from "zod/v4"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { Config } from "../config.js"

const DASH_CONFIG_PATH = join(homedir(), ".claude-dash", "config.json")
const CLAUDE_SETTINGS_PATH = join(homedir(), ".claude", "settings.json")
const TIMELINE_DIR = join(homedir(), ".claude-timeline")

const settingsSchema = z.object({
  costMethod: z.enum(["api", "estimated", "auto"]),
})

/**
 * Check if the cost-capture statusline is actually installed in Claude Code.
 * Requires: (1) capture.js exists in ~/.claude-timeline/, (2) settings.json
 * statusLine.command points to it.
 */
function isStatuslineInstalled(): boolean {
  const capturePath = join(TIMELINE_DIR, "capture.js")
  if (!existsSync(capturePath)) return false

  try {
    const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf-8"))
    const cmd = settings.statusLine?.command as string | undefined
    return typeof cmd === "string" && cmd.includes("capture.js")
  } catch {
    return false
  }
}

export function createStatusRouter(config: Config): Router {
  const router = Router()

  // GET /api/status — cost capture status + global settings
  router.get("/status", async (_req, res) => {
    const dbExists = existsSync(config.costStreamDbPath)
    const statuslineActive = isStatuslineInstalled()
    let sessionCount = 0

    if (dbExists) {
      try {
        // Dynamic import to avoid hard dependency
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

  // PUT /api/settings — update global cost method
  router.put("/settings", (req, res) => {
    const parsed = settingsSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_settings",
        message: parsed.error.issues.map((i) => i.message).join(", "),
        statusCode: 400,
      })
      return
    }

    // Read existing config
    let dashConfig: Record<string, unknown> = {}
    try {
      dashConfig = JSON.parse(readFileSync(DASH_CONFIG_PATH, "utf-8"))
    } catch {
      // config.json doesn't exist yet — expected on first run
    }

    // Update costMethod
    dashConfig.costMethod = parsed.data.costMethod

    // Write back
    try {
      const dir = join(homedir(), ".claude-dash")
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(DASH_CONFIG_PATH, JSON.stringify(dashConfig, null, 2))
    } catch (err) {
      res.status(500).json({
        error: "write_failed",
        message: "Failed to save settings",
        statusCode: 500,
      })
      return
    }

    res.json({
      costMethod: parsed.data.costMethod,
    })
  })

  return router
}
