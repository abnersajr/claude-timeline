import cors from "cors"
import express, { type Express } from "express"
import type { Config } from "./config.js"
import { loadConfig } from "./config.js"
import { mountRoutes } from "./routes.js"

export function createApp(config: Config): Express {
  const app = express()

  app.use(cors({ origin: config.corsOrigins }))
  app.use(express.json())

  mountRoutes(app, config)

  return app
}

// Direct execution detection
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}`

if (isDirectRun) {
  const config = loadConfig()
  const app = createApp(config)

  app.listen(config.port, () => {
    console.log(`claude-timeline-api listening on :${config.port}`)
  })
}
