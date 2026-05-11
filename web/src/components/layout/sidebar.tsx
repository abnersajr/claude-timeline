import { Link, useMatch } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { refreshSession } from "@/lib/api"
import { Button } from "@/components/ui/button"

export function Sidebar() {
  const sessionMatch = useMatch({ from: "/$sessionId", strict: false, shouldThrow: false })
  const sessionId = sessionMatch?.params?.sessionId
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefresh() {
    if (!sessionId || refreshing) return
    setRefreshing(true)
    try {
      const freshData = await refreshSession(sessionId)
      queryClient.setQueryData(["session", sessionId], freshData)
    } catch (err) {
      console.error("Refresh failed:", err)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <aside className="flex h-14 shrink-0 items-center border-b border-border bg-card px-6">
      <h1 className="mr-6 text-sm font-semibold tracking-tight text-foreground">
        Timeline
      </h1>
      <nav className="flex items-center gap-1">
        <Link
          to="/"
          className="rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
        >
          Sessions
        </Link>
      </nav>

      {sessionId && (
        <div className="ml-auto">
          <Button
            variant="ghost"
            size="xs"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <svg
              className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
              />
            </svg>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      )}
    </aside>
  )
}
