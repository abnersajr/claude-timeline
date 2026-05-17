import { statSync } from "node:fs"
import type { FullTimelineSession } from "claude-timeline-types"

interface CacheEntry {
  data: FullTimelineSession
  mtimeMs: number
}

export class SessionCache {
  private cache = new Map<string, CacheEntry>()

  get(sessionId: string, dbPath: string): FullTimelineSession | null {
    const entry = this.cache.get(sessionId)
    if (!entry) return null

    const currentMtime = this.getMtime(dbPath)
    if (currentMtime > entry.mtimeMs) {
      this.cache.delete(sessionId)
      return null
    }

    return entry.data
  }

  set(sessionId: string, data: FullTimelineSession, dbPath: string): void {
    const mtimeMs = this.getMtime(dbPath)
    this.cache.set(sessionId, { data, mtimeMs })
  }

  delete(sessionId: string): void {
    this.cache.delete(sessionId)
  }

  clear(): void {
    this.cache.clear()
  }

  private getMtime(dbPath: string): number {
    try {
      return statSync(dbPath).mtimeMs
    } catch {
      return 0
    }
  }
}
