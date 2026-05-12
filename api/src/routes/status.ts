import { Router } from "express"
import { z } from "zod/v4"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { Config } from "../config.js"

const DASH_CONFIG_PATH = join(homedir(), ".claude-dash", "config.json")

const settingsSchema = z.object({
  costMethod: z.enum(["api", "estimated", "auto"]),
})

export function createStatusRouter(config: Config): Router {
  const router = Router()

  // GET /api/status — cost capture status + global settings
  router.get("/status", async (_req, res) => {
    const dbExists = existsSync(config.costStreamDbPath)
    let sessionCount = 0

    if (dbExists) {
      try {
        // Dynamic import to avoid hard dependency
        const { CostStreamDb } = await import(
          "@timeline/extractor/cost-stream-db" as string
        )
        const db = new CostStreamDb(config.costStreamDbPath)
        sessionCount = db.getSessionIds().length
        db.close()
      } catch {
        // DB might be locked or corrupted
      }
    }

    res.json({
      costCapture: {
        installed: dbExists,
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
      // File doesn't exist yet
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
