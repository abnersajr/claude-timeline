import type { Express } from "express"
import { SessionCache } from "./cache.js"
import type { Config } from "./config.js"
import { healthRouter } from "./routes/health.js"
import { createSessionsRouter } from "./routes/sessions.js"

/**
 * Mount all API routes on the Express app.
 * NOT a barrel file — this does real work (mounting).
 */
export function mountRoutes(app: Express, config: Config): void {
  const cache = new SessionCache()
  const sessionsRouter = createSessionsRouter(config, cache)

  app.use("/api", healthRouter)
  app.use("/api", sessionsRouter)
}
