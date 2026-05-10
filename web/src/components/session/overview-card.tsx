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
    <div className="flex flex-col gap-1 rounded-lg bg-surface-2 p-3">
      <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-semibold text-text-primary",
          accent && "text-brand-400",
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
        "rounded-xl border border-border bg-surface-1 p-6",
        className,
      )}
    >
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">
          {session.projectName}
        </h2>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
            session.isOngoing
              ? "bg-accent-green/15 text-accent-green"
              : "bg-surface-3 text-text-secondary",
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
      <div className="mt-4 flex items-center gap-2 text-xs text-text-muted">
        <span className="font-medium">Working Directory:</span>
        <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-text-secondary">
          {session.workingDirectory}
        </code>
      </div>

      {/* Time range */}
      <div className="mt-2 flex items-center gap-4 text-xs text-text-muted">
        <span>
          Started: <span className="text-text-secondary">{formatDate(session.startTime)}</span>
        </span>
        <span>
          Ended: <span className="text-text-secondary">{formatDate(session.endTime)}</span>
        </span>
      </div>
    </div>
  )
}
