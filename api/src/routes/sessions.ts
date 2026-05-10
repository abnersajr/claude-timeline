import { Router } from "express"
import { z } from "zod/v4"
import type { SessionCache } from "../cache.js"
import type { Config } from "../config.js"

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

const idParamSchema = z.object({
  id: z.string().min(1),
})

export function createSessionsRouter(config: Config, cache: SessionCache): Router {
  const router = Router()

  router.get("/sessions", async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_query",
        message: parsed.error.issues.map((i) => i.message).join(", "),
        statusCode: 400,
      })
      return
    }

    try {
      const { listSessions } = await import("@timeline/extractor/db-reader")
      const sessions = listSessions(config.dbPath, parsed.data.limit)
      res.json(sessions)
    } catch (err) {
      console.error("Failed to list sessions:", err)
      res.status(500).json({
        error: "extraction_failed",
        message: "Failed to read sessions from database",
        statusCode: 500,
      })
    }
  })

  router.get("/sessions/:id", async (req, res) => {
    const parsed = idParamSchema.safeParse(req.params)
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_params",
        message: parsed.error.issues.map((i) => i.message).join(", "),
        statusCode: 400,
      })
      return
    }

    const sessionId = parsed.data.id

    // Check cache first
    const cached = cache.get(sessionId, config.dbPath)
    if (cached) {
      res.json(cached)
      return
    }

    try {
      const { extractFullTimeline } = await import("@timeline/extractor/merger")
      const data = await extractFullTimeline(sessionId, config.dbPath, config.projectsDir)
      cache.set(sessionId, data, config.dbPath)
      res.json(data)
    } catch (err: unknown) {
      const code = (err as { code?: number }).code
      if (code === 2) {
        res.status(404).json({
          error: "not_found",
          message: `Session not found: ${sessionId}`,
          statusCode: 404,
        })
        return
      }
      console.error("Failed to extract session:", err)
      res.status(500).json({
        error: "extraction_failed",
        message: "Failed to extract session timeline",
        statusCode: 500,
      })
    }
  })

  return router
}
