import type { FullTimelineSession } from "@claude-timeline/types"

export interface SessionSummary {
  sessionId: string
  projectName: string
  model: string
  turnCount: number
  lastTimestamp: string
  totalCostEstimate: number
  hasThinking?: boolean
  activeDurationMs?: number
  apiTotalCost?: number | null
}

export interface CostStatus {
  costCapture: {
    installed: boolean
    dbExists: boolean
    dbPath: string
    sessionCount: number
  }
  costMethod: "api" | "estimated" | "auto"
}

export interface SettingsUpdate {
  costMethod: "api" | "estimated" | "auto"
}

const API_BASE = import.meta.env.VITE_API_URL ?? ""

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

export async function refreshSession(
  id: string,
): Promise<FullTimelineSession> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}/refresh`, {
    method: "POST",
  })
  if (!res.ok) throw new Error(`Failed to refresh session: ${res.status}`)
  return res.json()
}

export async function refreshSessions(): Promise<SessionSummary[]> {
  const res = await fetch(`${API_BASE}/api/sessions/refresh`, {
    method: "POST",
  })
  if (!res.ok) throw new Error(`Failed to refresh sessions: ${res.status}`)
  return res.json()
}

export async function fetchStatus(): Promise<CostStatus> {
  const res = await fetch(`${API_BASE}/api/status`)
  if (!res.ok) throw new Error(`Failed to fetch status: ${res.status}`)
  return res.json()
}

export async function updateCostMethod(
  method: "api" | "estimated" | "auto",
): Promise<{ costMethod: string }> {
  const res = await fetch(`${API_BASE}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ costMethod: method }),
  })
  if (!res.ok) throw new Error(`Failed to update settings: ${res.status}`)
  return res.json()
}
