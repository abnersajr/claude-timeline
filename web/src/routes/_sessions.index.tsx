import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { fetchSessions } from "@/lib/api"
import { SessionListSkeleton } from "@/components/session/skeleton"
import { NoSessionsEmpty, ApiUnreachableEmpty } from "@/components/empty-states"
import { ErrorBoundary, ErrorFallback } from "@/components/error-boundary"
import { TokenBadgeGroup } from "@/components/session/token-badge"
import { formatCost, formatDate, formatTokens } from "@/lib/utils"
import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"

export const Route = createFileRoute("/_sessions/")({
  component: SessionListPage,
})

function SessionListContent() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => fetchSessions(50, 0),
  })

  if (isLoading) {
    return <SessionListSkeleton />
  }

  if (error) {
    const isNetworkError =
      error instanceof TypeError && error.message === "Failed to fetch"

    if (isNetworkError) {
      return <ApiUnreachableEmpty onRetry={() => refetch()} />
    }

    return (
      <ErrorFallback
        error={error as Error}
        onRetry={() => refetch()}
        title="Failed to load sessions"
      />
    )
  }

  const sessions = data?.sessions ?? []

  if (sessions.length === 0) {
    return <NoSessionsEmpty onRetry={() => refetch()} />
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
            <th className="px-4 py-3">Project</th>
            <th className="px-4 py-3">Model</th>
            <th className="px-4 py-3 text-right">Turns</th>
            <th className="px-4 py-3 text-right">Tokens</th>
            <th className="px-4 py-3 text-right">Cost</th>
            <th className="px-4 py-3">Time</th>
            <th className="px-4 py-3">Status</th>
            <th className="w-10 px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => {
            const totalTokens =
              session.totalTokens.inputTokens +
              session.totalTokens.outputTokens +
              session.totalTokens.cacheReadTokens

            return (
              <tr
                key={session.id}
                className="border-b border-border transition-colors hover:bg-surface-1"
              >
                <td className="px-4 py-3 font-medium text-text-primary">
                  <Link
                    to="/_sessions/$sessionId"
                    params={{ sessionId: session.id }}
                    className="hover:text-brand-400 transition-colors"
                  >
                    {session.projectName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {session.model}
                </td>
                <td className="px-4 py-3 text-right text-text-secondary">
                  {session.turnCount}
                </td>
                <td className="px-4 py-3 text-right text-text-secondary">
                  {formatTokens(totalTokens)}
                </td>
                <td className="px-4 py-3 text-right font-medium text-brand-400">
                  {formatCost(session.estimatedCost ?? 0)}
                </td>
                <td className="px-4 py-3 text-text-muted">
                  {formatDate(session.startTime)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      session.isOngoing
                        ? "bg-accent-green/15 text-accent-green"
                        : "bg-surface-3 text-text-secondary"
                    }`}
                  >
                    {session.isOngoing ? "Ongoing" : "Completed"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <ChevronRight className="h-4 w-4 text-text-muted" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SessionListPage() {
  return (
    <ErrorBoundary>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            Sessions
          </h1>
          <p className="text-sm text-text-muted">
            Browse and inspect your Claude Code timeline sessions.
          </p>
        </div>
        <SessionListContent />
      </div>
    </ErrorBoundary>
  )
}
