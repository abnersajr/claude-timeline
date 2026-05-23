import { useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchSessions, refreshSessions } from "@/lib/api"
import { SessionListRow } from "./session-list-row"
import { EmptyState } from "@/components/empty-states"
import { Loader2, RefreshCw, Eye, EyeOff } from "lucide-react"
import { useState } from "react"
import type { SessionSummary } from "@/lib/api"

type RangeKey = "today" | "7d" | "30d" | "90d" | "all"

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "all", label: "All" },
]

function getCutoff(range: RangeKey): Date | null {
  const now = new Date()
  switch (range) {
    case "today": {
      const start = new Date(now)
      start.setHours(0, 0, 0, 0)
      return start
    }
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    case "90d":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    case "all":
      return null
  }
}

function filterByRange(sessions: SessionSummary[], range: RangeKey): SessionSummary[] {
  const cutoff = getCutoff(range)
  if (!cutoff) return sessions
  return sessions.filter((s) => new Date(s.endTime) >= cutoff)
}

function loadRange(): RangeKey {
  try {
    const stored = localStorage.getItem("claude-timeline.range")
    if (stored && RANGE_OPTIONS.some((o) => o.key === stored)) {
      return stored as RangeKey
    }
  } catch {
    // localStorage unavailable
  }
  return "7d"
}

function saveRange(range: RangeKey) {
  try {
    localStorage.setItem("claude-timeline.range", range)
  } catch {
    // localStorage unavailable
  }
}

export function SessionList() {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const [showEmpty, setShowEmpty] = useState(false)
  const [selectedRange, setSelectedRange] = useState<RangeKey>(loadRange)
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => fetchSessions(50),
  })

  function handleToggleExpand(sessionId: string) {
    setExpandedSessionId((prev) => (prev === sessionId ? null : sessionId))
  }

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      const freshData = await refreshSessions()
      queryClient.setQueryData(["sessions"], freshData)
    } catch (err) {
      console.error("Refresh failed:", err)
    } finally {
      setRefreshing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-text-secondary">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading sessions...
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-accent-red/50 bg-accent-red/10 p-6 text-center">
        <p className="font-medium text-accent-red">Failed to load sessions</p>
        <p className="mt-1 text-sm text-text-secondary">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    )
  }

  function handleRangeChange(range: RangeKey) {
    setSelectedRange(range)
    saveRange(range)
  }

  const sessions = data ?? []
  const dateFiltered = filterByRange(sessions, selectedRange)
  const filteredSessions = showEmpty
    ? dateFiltered
    : dateFiltered.filter((s) => s.totalCost > 0 || (s.apiTotalCost != null && s.apiTotalCost > 0))

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon="inbox"
        title="No sessions found"
        description="Claude Code session data will appear here after you run some sessions."
        action={{ label: "Refresh", onClick: handleRefresh }}
      />
    )
  }

  if (dateFiltered.length === 0 && sessions.length > 0) {
    return (
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => handleRangeChange(opt.key)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  selectedRange === opt.key
                    ? "bg-primary/20 text-primary shadow-sm"
                    : "text-text-muted hover:bg-surface-2 hover:text-text-primary"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
            <div className="rounded-full bg-muted p-4">
              <Eye className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-[var(--text)]">No sessions in this range</h3>
              <p className="max-w-sm text-sm text-[var(--muted)]">
                Try a different date range or check Show Empty.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => handleRangeChange(opt.key)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                selectedRange === opt.key
                  ? "bg-primary/20 text-primary shadow-sm"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-primary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEmpty(!showEmpty)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-muted transition-all hover:bg-surface-2 hover:text-text-primary"
          >
            {showEmpty ? (
              <>
                <EyeOff className="h-3.5 w-3.5" />
                Hide Empty
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5" />
                Show Empty
              </>
            )}
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary transition-all hover:bg-primary/25 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/50 text-left">
              <th className="px-4 py-3 font-medium text-text-primary">Session</th>
              <th className="px-4 py-3 font-medium text-text-primary">Model</th>
              <th className="px-4 py-3 text-right font-medium text-text-primary">
                Turns
              </th>
              <th className="px-4 py-3 text-right font-medium text-text-primary">
                Cost
              </th>
              <th className="px-4 py-3 font-medium text-text-primary">Time</th>
              <th className="px-4 py-3 text-right font-medium text-text-primary">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredSessions.map((session) => (
              <SessionListRow
                key={session.sessionId}
                session={session}
                expanded={expandedSessionId === session.sessionId}
                onToggleExpand={handleToggleExpand}
              />
            ))}
          </tbody>
        </table>
        {filteredSessions.length === 0 && sessions.length > 0 && !showEmpty && (
          <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
            <div className="rounded-full bg-muted p-4">
              <EyeOff className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-[var(--text)]">All sessions hidden</h3>
              <p className="max-w-sm text-sm text-[var(--muted)]">
                Toggle Show Empty to see zero-cost sessions.
              </p>
            </div>
          </div>
        )}
        {filteredSessions.length === 0 && dateFiltered.length > 0 && showEmpty && (
          <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
            <div className="rounded-full bg-muted p-4">
              <Eye className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-[var(--text)]">No sessions in this range</h3>
              <p className="max-w-sm text-sm text-[var(--muted)]">
                Try a different date range or check Show Empty.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
