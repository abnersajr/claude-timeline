import type { SessionMetadata, SessionPricing } from "claude-timeline-types"
import { cn, formatCost, formatDate, formatDuration } from "@/lib/utils"

/** Format large numbers compactly: 1234 → "1.2K", 1234567 → "1.2M", etc. */
const compact = (n: number) => {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B"
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M"
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K"
  return n.toString()
}

interface OverviewCardProps {
  session: SessionMetadata
  pricing: SessionPricing
  className?: string
}

interface StatCardProps {
  label: string
  value: string
  title?: string
  accent?: boolean
}

function StatCard({ label, value, title, accent }: StatCardProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3">
      <span className="block text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </span>
      <span
        title={title}
        className={cn(
          "block font-mono text-lg font-medium text-[var(--foreground)]",
          accent && "text-[var(--primary)]",
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

  const cacheReadPercent =
    totalTokens > 0
      ? Math.round((session.totalTokens.cacheReadTokens / totalTokens) * 100)
      : 0

  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--card)] p-6",
        className,
      )}
    >
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--foreground)]">
            {('sessionName' in session ? String((session as Record<string, unknown>).sessionName ?? '') : '') || session.sessionId}
          </h2>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
              session.isOngoing
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-[var(--accent)] text-[var(--muted-foreground)]",
            )}
          >
            {session.isOngoing ? "Ongoing" : "Completed"}
          </span>
        </div>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {session.projectName}
        </p>
      </div>

      {/* KPI stat cards */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}
      >
        <StatCard
          label="Turns"
          value={String(session.turnCount)}
          title={String(session.turnCount)}
        />
        <StatCard
          label="Input Tokens"
          value={compact(session.totalTokens.inputTokens)}
          title={session.totalTokens.inputTokens.toLocaleString()}
        />
        <StatCard
          label="Output Tokens"
          value={compact(session.totalTokens.outputTokens)}
          title={session.totalTokens.outputTokens.toLocaleString()}
        />
        <StatCard
          label="Cache Read"
          value={`${compact(session.totalTokens.cacheReadTokens)} (${cacheReadPercent}%)`}
          title={`${session.totalTokens.cacheReadTokens.toLocaleString()} (${cacheReadPercent}%)`}
        />
        <StatCard
          label="Cost"
          value={formatCost(pricing.totalCost)}
          title={formatCost(pricing.totalCost)}
          accent
        />
      </div>

      {/* Secondary stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Model" value={session.model} title={session.model} />
        <StatCard label="Total Tokens" value={compact(totalTokens)} title={totalTokens.toLocaleString()} />
        <StatCard label="Duration" value={formatDuration(durationMs)} title={`${Math.round(durationMs / 1000)}s`} />
        {session.activeDurationMs != null && session.activeDurationMs > 0 && (
          <StatCard label="Active Time" value={formatDuration(session.activeDurationMs)} title={`${Math.round(session.activeDurationMs / 1000)}s`} accent />
        )}
      </div>

      {/* Cost source detail */}
      <div className="mt-3 flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium",
            pricing.costSource === "api"
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-[var(--muted)] text-[var(--muted-foreground)]",
          )}
        >
          {pricing.costSource === "api" ? "● API" : "○ Est."}
        </span>
        {pricing.apiTotalCost != null &&
          pricing.costSource !== "api" &&
          pricing.apiTotalCost !== pricing.totalCost && (
            <span className="text-[0.625rem] text-[var(--muted-foreground)]">
              {formatCost(pricing.apiTotalCost)} from API
            </span>
          )}
        {pricing.costSource === "api" &&
          pricing.estimatedTotalCost != null &&
          pricing.estimatedTotalCost !== pricing.totalCost && (
            <span className="text-[0.625rem] text-[var(--muted-foreground)]">
              ~{formatCost(pricing.estimatedTotalCost)} estimated
            </span>
          )}
      </div>

      {/* Working directory */}
      <div className="mt-4 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
        <span className="font-medium">Working Directory:</span>
        <code className="rounded bg-[var(--accent)] px-1.5 py-0.5 font-mono text-[var(--muted-foreground)]">
          {session.workingDirectory}
        </code>
      </div>

      {/* Time range */}
      <div className="mt-2 flex items-center gap-4 text-xs text-[var(--muted-foreground)]">
        <span>
          Started: <span className="text-[var(--muted-foreground)]">{formatDate(session.startTime)}</span>
        </span>
        <span>
          Ended: <span className="text-[var(--muted-foreground)]">{formatDate(session.endTime)}</span>
        </span>
      </div>

      {/* Glossary */}
      <details className="mt-4 rounded-lg border border-[var(--border)] overflow-hidden">
        <summary className="cursor-pointer px-4 py-3 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
          What do these numbers mean?
        </summary>
        <div className="px-4 pb-4 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="font-medium text-[var(--foreground)]">Session</dt>
            <dd className="text-[var(--muted-foreground)]">One continuous run of Claude Code, from start to exit.</dd>
            <dt className="font-medium text-[var(--foreground)]">Turn</dt>
            <dd className="text-[var(--muted-foreground)]">A single user message + assistant response exchange.</dd>
            <dt className="font-medium text-[var(--foreground)]">Input Tokens</dt>
            <dd className="text-[var(--muted-foreground)]">Tokens sent to the model (your messages + context).</dd>
            <dt className="font-medium text-[var(--foreground)]">Output Tokens</dt>
            <dd className="text-[var(--muted-foreground)]">Tokens generated by the model (responses + tool calls).</dd>
            <dt className="font-medium text-[var(--foreground)]">Cache Read</dt>
            <dd className="text-[var(--muted-foreground)]">Tokens reused from previous API calls. Reduces cost significantly.</dd>
            <dt className="font-medium text-[var(--foreground)]">Cache Write</dt>
            <dd className="text-[var(--muted-foreground)]">New cached tokens written to the cache.</dd>
            <dt className="font-medium text-[var(--foreground)]">Cost Estimate</dt>
            <dd className="text-[var(--muted-foreground)]">Calculated from token counts × model pricing rates. May differ from actual billing.</dd>
          </dl>
        </div>
      </details>
    </div>
  )
}
