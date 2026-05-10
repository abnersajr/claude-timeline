import type { FullTimelineSession } from "@timeline/types"

export interface SessionSummary {
  sessionId: string
  projectName: string
  model: string
  turnCount: number
  lastTimestamp: string
  totalCostEstimate: number
}

const API_BASE = import.meta.env.VITE_API_URL ?? "https://api.claude-dash.local"

export async function fetchSessions(
  limit = 50,
): Promise<SessionSummary[]> {
  const res = await fetch(
    `${API_BASE}/api/sessions?limit=${limit}`,
  )
  if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`)
  return res.json()
}

export async function fetchSession(
  id: string,
): Promise<FullTimelineSession> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`)
  if (!res.ok) throw new Error(`Failed to fetch session: ${res.status}`)
  return res.json()
}
