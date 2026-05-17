import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { fetchSession } from "@/lib/api"
import { OverviewCard } from "@/components/session/overview-card"
import { ChatTimeline } from "@/components/session/chat-timeline"
import { TokenChart } from "@/components/session/token-chart"
import { CostBreakdown } from "@/components/session/cost-breakdown"
import { ContextStats } from "@/components/session/context-stats"
import { SessionDetailSkeleton } from "@/components/session/skeleton"
import { ErrorBoundary, ErrorFallback } from "@/components/error-boundary"

export const Route = createFileRoute("/$sessionId")({
  component: SessionDetailPage,
})

function SessionDetailContent() {
  const { sessionId } = Route.useParams()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => fetchSession(sessionId),
    // Auto-poll ongoing sessions every 5s
    refetchInterval: (query) => {
      const session = query.state.data?.session
      if (session?.isOngoing) return 5000
      return false
    },
    refetchIntervalInBackground: true,
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
      <div className="p-12 text-center text-muted-foreground">
        No data returned for session {sessionId}.
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <OverviewCard session={data.session} pricing={data.pricing} />

      {/* Token chart + Cost breakdown side by side on wide screens */}
      <div className="grid gap-6 lg:grid-cols-2">
        <TokenChart turns={data.turns} turnsPricing={data.pricing.turnsPricing} />
        <CostBreakdown pricing={data.pricing} turns={data.turns} />
      </div>

      <ChatTimeline
        conversationGroups={data.conversationGroups ?? []}
        turns={data.turns}
        turnsPricing={data.pricing.turnsPricing}
        subagents={data.subagents}
      />

      {data.contextStats && <ContextStats stats={data.contextStats} />}
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
