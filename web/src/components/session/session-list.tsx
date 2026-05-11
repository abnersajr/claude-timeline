import { useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchSessions, refreshSessions } from "@/lib/api"
import { SessionListRow } from "./session-list-row"
import { Loader2, RefreshCw } from "lucide-react"
import { useState } from "react"

export function SessionList() {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => fetchSessions(50),
  })

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

  const sessions = data ?? []

  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface-1 p-12 text-center">
        <p className="text-lg font-medium text-text-primary">No sessions yet</p>
        <p className="mt-1 text-sm text-text-secondary">
          Sessions will appear here once they are recorded.
        </p>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary transition-all hover:bg-primary/25 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary transition-all hover:bg-primary/25 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2/50 text-left">
            <th className="px-4 py-3 font-medium text-text-primary">Project</th>
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
          {sessions.map((session) => (
            <SessionListRow
              key={session.sessionId}
              session={session}
            />
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}
