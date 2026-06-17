import type { SessionSummary } from "@/lib/api"
import { formatCost, formatTokens, formatDurationHm, modelTier } from "@/lib/utils"
import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"

interface SessionListRowProps {
  session: SessionSummary
  expanded: boolean
  onToggleExpand: (sessionId: string) => void
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

export function SessionListRow({ session, expanded, onToggleExpand }: SessionListRowProps) {
  const hasApi = session.apiTotalCost != null
  const cost = hasApi ? session.apiTotalCost! : session.totalCostEstimate

  return (
    <>
      <tr
        className="border-b border-border transition-colors hover:bg-muted/30 cursor-pointer select-none"
        onClick={() => onToggleExpand(session.sessionId)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
            />
            <div>
              <div className="font-medium text-foreground">
                {session.sessionId}
              </div>
              <div className="mt-0.5 text-sm text-foreground/70">
                {session.projectName}
              </div>
            </div>
          </div>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
          <code className={`rounded border px-1.5 py-0.5 text-xs model-${modelTier(session.model)}`}>
            {session.model}
          </code>
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
          {session.turnCount}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {hasApi ? (
            <div className="flex items-center justify-end gap-2">
              <span className="text-sm text-muted-foreground">
                <span className="text-[0.625rem] font-medium uppercase tracking-wider opacity-60">Est </span>
                {formatCost(session.totalCostEstimate)}
              </span>
              <span className="text-sm font-medium text-primary">
                <span className="text-[0.625rem] font-medium uppercase tracking-wider opacity-60">API </span>
                {formatCost(session.apiTotalCost!)}
              </span>
              {session.hasThinking && (
                <span className="inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-amber-400">
                  THINK
                </span>
              )}
              {session.cacheReadTokens > 0 && (
                <span className="inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-amber-400">
                  CACHE {formatTokens(session.cacheReadTokens)}
                </span>
              )}
              {session.cacheWriteTokens > 0 && (
                <span className="inline-flex items-center rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-violet-400">
                  WRITE {session.cacheWriteType} {formatTokens(session.cacheWriteTokens)}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-end gap-1.5">
              <span className="text-sm text-muted-foreground">
                {formatCost(cost)}
              </span>
              {session.hasThinking && (
                <span className="inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-amber-400">
                  THINK
                </span>
              )}
              {session.cacheReadTokens > 0 && (
                <span className="inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-amber-400">
                  CACHE {formatTokens(session.cacheReadTokens)}
                </span>
              )}
              {session.cacheWriteTokens > 0 && (
                <span className="inline-flex items-center rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-violet-400">
                  WRITE {session.cacheWriteType} {formatTokens(session.cacheWriteTokens)}
                </span>
              )}
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-muted-foreground">
          {formatTime(session.lastTimestamp)}
        </td>
        <td className="px-4 py-3 text-right">
          <Link
            to="/$sessionId"
            params={{ sessionId: session.sessionId }}
            className="inline-flex items-center rounded-md bg-primary/15 px-4 py-1.5 text-xs font-medium text-primary transition-all hover:bg-primary/25 hover:shadow-[0_0_12px_rgba(99,102,241,0.4)]"
            onClick={(e) => e.stopPropagation()}
          >
            View
          </Link>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="border-t border-border bg-card px-4 py-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
              {session.activeDurationMs != null && (
                <div>
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Duration</span>
                  <p className="mt-0.5 font-medium text-foreground">{formatDurationHm(session.activeDurationMs)}</p>
                </div>
              )}
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Turns</span>
                <p className="mt-0.5 font-medium text-foreground">{session.turnCount}</p>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Cost</span>
                <p className="mt-0.5 font-medium text-foreground">{formatCost(cost)}</p>
              </div>
              {session.cacheReadTokens > 0 && (
                <div>
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Cache Read</span>
                  <p className="mt-0.5 font-medium text-amber-400">{formatTokens(session.cacheReadTokens)}</p>
                </div>
              )}
              {session.cacheWriteTokens > 0 && (
                <div>
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Cache Write</span>
                  <p className="mt-0.5 font-medium text-violet-400">{session.cacheWriteType} {formatTokens(session.cacheWriteTokens)}</p>
                </div>
              )}
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Model</span>
                <p className="mt-0.5">
                  <code className={`rounded border px-1.5 py-0.5 text-xs model-${modelTier(session.model)}`}>
                    {session.model}
                  </code>
                </p>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Project</span>
                <p className="mt-0.5 truncate font-medium text-foreground" title={session.projectName}>
                  {session.projectName}
                </p>
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <Link
                to="/$sessionId"
                params={{ sessionId: session.sessionId }}
                className="inline-flex items-center text-xs font-medium text-primary hover:underline"
              >
                View full session →
              </Link>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
