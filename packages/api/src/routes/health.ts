import { type IRouter, Router } from "express"

export const healthRouter: IRouter = Router()

const startTime = Date.now()

healthRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "0.1.0",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  })
})
