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
      const { listSessions, listJsonlSessions } = await import(
        "@timeline/extractor/db-reader"
      )
      const dbSessions = listSessions(config.dbPath, parsed.data.limit)
      const jsonlSessions = listJsonlSessions(
        config.projectsDir,
        config.dbPath,
        parsed.data.limit,
      )

      // Merge: SQLite sessions first, then JSONL-discovered sessions
      const seen = new Set(dbSessions.map((s) => s.sessionId))
      const merged = [...dbSessions]
      for (const s of jsonlSessions) {
        if (!seen.has(s.sessionId)) {
          merged.push(s)
          seen.add(s.sessionId)
        }
      }

      merged.sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp))
      res.json(merged)
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
      const { extractFullTimeline, extractJsonlTimeline } = await import(
        "@timeline/extractor/merger"
      )

      let data
      try {
        data = await extractFullTimeline(sessionId, config.dbPath, config.projectsDir)
      } catch (err: unknown) {
        // Session not in SQLite — try JSONL-only extraction
        if ((err as { code?: number }).code === 2) {
          const { readdirSync, existsSync } = await import("node:fs")
          const { join } = await import("node:path")
          let foundPath: string | null = null
          for (const dir of readdirSync(config.projectsDir)) {
            const candidate = join(config.projectsDir, dir, `${sessionId}.jsonl`)
            if (existsSync(candidate)) {
              foundPath = candidate
              break
            }
          }
          if (foundPath) {
            data = await extractJsonlTimeline(sessionId, config.projectsDir, foundPath)
          } else {
            throw err // Re-throw original 404
          }
        } else {
          throw err
        }
      }

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

  router.post("/sessions/refresh", async (_req, res) => {
    // Bust entire cache and re-read from SQLite + JSONL files on disk
    cache.clear()

    try {
      const { listSessions, listJsonlSessions } = await import(
        "@timeline/extractor/db-reader"
      )
      const dbSessions = listSessions(config.dbPath, 100)
      const jsonlSessions = listJsonlSessions(config.projectsDir, config.dbPath, 100)

      // Merge: SQLite sessions first, then JSONL-discovered sessions
      const seen = new Set(dbSessions.map((s) => s.sessionId))
      const merged = [...dbSessions]
      for (const s of jsonlSessions) {
        if (!seen.has(s.sessionId)) {
          merged.push(s)
          seen.add(s.sessionId)
        }
      }

      // Sort by most recent first
      merged.sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp))
      res.json(merged)
    } catch (err) {
      console.error("Failed to refresh sessions:", err)
      res.status(500).json({
        error: "extraction_failed",
        message: "Failed to refresh sessions from database",
        statusCode: 500,
      })
    }
  })

  router.post("/sessions/:id/refresh", async (req, res) => {
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

    // Always bust cache and re-extract
    cache.delete(sessionId)

    try {
      const { extractFullTimeline, extractJsonlTimeline } = await import(
        "@timeline/extractor/merger"
      )

      let data
      try {
        data = await extractFullTimeline(sessionId, config.dbPath, config.projectsDir)
      } catch (err: unknown) {
        // Session not in SQLite — try JSONL-only extraction
        if ((err as { code?: number }).code === 2) {
          const { readdirSync, existsSync } = await import("node:fs")
          const { join } = await import("node:path")
          let foundPath: string | null = null
          for (const dir of readdirSync(config.projectsDir)) {
            const candidate = join(config.projectsDir, dir, `${sessionId}.jsonl`)
            if (existsSync(candidate)) {
              foundPath = candidate
              break
            }
          }
          if (foundPath) {
            data = await extractJsonlTimeline(sessionId, config.projectsDir, foundPath)
          } else {
            throw err
          }
        } else {
          throw err
        }
      }

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
      console.error("Failed to refresh session:", err)
      res.status(500).json({
        error: "extraction_failed",
        message: "Failed to refresh session timeline",
        statusCode: 500,
      })
    }
  })

  return router
}
