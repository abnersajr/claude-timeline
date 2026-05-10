import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { fetchSession } from "@/lib/api"
import { OverviewCard } from "@/components/session/overview-card"
import { Timeline } from "@/components/session/timeline"
import { TokenChart } from "@/components/session/token-chart"
import { CostBreakdown } from "@/components/session/cost-breakdown"
import { ContextStats } from "@/components/session/context-stats"
import { SessionDetailSkeleton } from "@/components/session/skeleton"
import { ErrorBoundary, ErrorFallback } from "@/components/error-boundary"

export const Route = createFileRoute("/_sessions/$sessionId")({
  component: SessionDetailPage,
})

function SessionDetailContent() {
  const { sessionId } = Route.useParams()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => fetchSession(sessionId),
  })

  if (isLoading) {
    return <SessionDetailSkeleton />
  }

  if (error) {
    const isNetworkError =
      error instanceof TypeError && error.message === "Failed to fetch"

    return (
      <ErrorFallback
        error={error as Error}
        onRetry={() => refetch()}
        title={isNetworkError ? "Cannot reach API" : "Failed to load session"}
        description={
          isNetworkError
            ? "The timeline API server is not responding. Make sure it's running on port 3001."
            : undefined
        }
      />
    )
  }

  if (!data) {
    return (
      <div className="p-12 text-center text-text-muted">
        No data returned for session {sessionId}.
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <OverviewCard session={data.session} pricing={data.pricing} />

      {/* Token chart + Cost breakdown side by side on wide screens */}
      <div className="grid gap-6 lg:grid-cols-2">
        <TokenChart turns={data.turns} />
        <CostBreakdown pricing={data.pricing} turns={data.turns} />
      </div>

      <Timeline turns={data.turns} turnsPricing={data.pricing.turnsPricing} />

      {data.contextStats && <ContextStats stats={data.contextStats} />}

      {/* Subagents placeholder — will be wired in Task 11 */}
      {data.subagents && data.subagents.length > 0 && (
        <div className="rounded-lg border border-border bg-surface-1 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
            Subagents ({data.subagents.length})
          </h3>
          <p className="mt-2 text-xs text-text-muted">
            Subagent details coming soon.
          </p>
        </div>
      )}
    </div>
  )
}

function SessionDetailPage() {
  return (
    <ErrorBoundary>
      <SessionDetailContent />
    </ErrorBoundary>
  )
}
