import type { SessionMetadata, SessionPricing } from "@timeline/types"
import { cn, formatCost, formatDate, formatDuration, formatTokens } from "@/lib/utils"

interface OverviewCardProps {
  session: SessionMetadata
  pricing: SessionPricing
  className?: string
}

interface StatItemProps {
  label: string
  value: string
  accent?: boolean
}

function StatItem({ label, value, accent }: StatItemProps) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-semibold text-foreground",
          accent && "text-primary",
        )}
      >
        {value}
      </span>
    </div>
  )
}

export function OverviewCard({ session, pricing, className }: OverviewCardProps) {
  const durationMs =
    new Date(session.endTime).getTime() - new Date(session.startTime).getTime()

  const totalTokens =
    session.totalTokens.inputTokens +
    session.totalTokens.outputTokens +
    session.totalTokens.cacheReadTokens

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-6",
        className,
      )}
    >
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">
          {session.projectName}
        </h2>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
            session.isOngoing
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-accent text-muted-foreground",
          )}
        >
          {session.isOngoing ? "Ongoing" : "Completed"}
        </span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatItem label="Model" value={session.model} />
        <StatItem label="Turns" value={String(session.turnCount)} />
        <StatItem label="Total Tokens" value={formatTokens(totalTokens)} />
        <StatItem label="Cost" value={formatCost(pricing.totalCost)} accent />
        <StatItem label="Duration" value={formatDuration(durationMs)} />
        {session.activeDurationMs != null && session.activeDurationMs > 0 && (
          <StatItem label="Active Time" value={formatDuration(session.activeDurationMs)} accent />
        )}
        <StatItem
          label="Input Tokens"
          value={formatTokens(session.totalTokens.inputTokens)}
        />
        <StatItem
          label="Output Tokens"
          value={formatTokens(session.totalTokens.outputTokens)}
        />
        <StatItem
          label="Cache Read"
          value={formatTokens(session.totalTokens.cacheReadTokens)}
        />
      </div>

      {/* Working directory */}
      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">Working Directory:</span>
        <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-muted-foreground">
          {session.workingDirectory}
        </code>
      </div>

      {/* Time range */}
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          Started: <span className="text-muted-foreground">{formatDate(session.startTime)}</span>
        </span>
        <span>
          Ended: <span className="text-muted-foreground">{formatDate(session.endTime)}</span>
        </span>
      </div>
    </div>
  )
}
