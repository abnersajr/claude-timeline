import type { FullTimelineSession, SessionMetadata } from "@timeline/types"

const API_BASE = import.meta.env.VITE_API_URL ?? "https://api.claude-dash.local"

interface SessionListResponse {
  sessions: SessionMetadata[]
  total: number
}

export async function fetchSessions(
  limit = 50,
  offset = 0,
): Promise<SessionListResponse> {
  const res = await fetch(
    `${API_BASE}/api/sessions?limit=${limit}&offset=${offset}`,
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
