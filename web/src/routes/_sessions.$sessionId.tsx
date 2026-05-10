import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { fetchSession } from "@/lib/api"
import { OverviewCard } from "@/components/session/overview-card"
import { Timeline } from "@/components/session/timeline"
import { TokenChart } from "@/components/session/token-chart"
import { CostBreakdown } from "@/components/session/cost-breakdown"
import { ContextStats } from "@/components/session/context-stats"
import { SessionDetailSkeleton } from "@/components/session/skeleton"

export const Route = createFileRoute("/_sessions/$sessionId")({
  component: SessionDetailPage,
})

function SessionDetailPage() {
  const { sessionId } = Route.useParams()

  const { data, isLoading, error } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => fetchSession(sessionId),
  })

  if (isLoading) {
    return <SessionDetailSkeleton />
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-12">
        <div className="rounded-full bg-accent-red/15 p-3">
          <svg
            className="h-6 w-6 text-accent-red"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>
        <p className="text-sm font-medium text-text-primary">
          Failed to load session
        </p>
        <p className="text-xs text-text-muted">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
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
