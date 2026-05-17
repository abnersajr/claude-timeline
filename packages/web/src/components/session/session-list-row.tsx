import type { SessionSummary } from "@/lib/api"
import { formatCost } from "@/lib/utils"
import { Link } from "@tanstack/react-router"

interface SessionListRowProps {
  session: SessionSummary
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

/**
 * When thinking is enabled, the JSONL estimate excludes thinking tokens
 * (billed at output rate but stripped from JSONL). Apply a conservative
 * 1.5× multiplier to the output portion of the cost as a rough estimate.
 *
 * output_cost = (outputTokens / 1M) * outputRate
 * total_cost = inputCost + outputCost + cacheReadCost + cacheCreationCost
 * adjusted = totalCost + (outputCost * 0.5)  // 1.5× on output only
 */
function thinkingAdjustedEstimate(session: SessionSummary): number {
  if (!session.hasThinking) return session.totalCostEstimate
  // Rough heuristic: thinking adds ~50% to output cost
  // Since we don't have per-turn breakdown here, apply 1.5× to full estimate
  // (conservative — thinking cost varies per session)
  return session.totalCostEstimate * 1.5
}

export function SessionListRow({ session }: SessionListRowProps) {
  const hasApi = session.apiTotalCost != null
  const adjustedEstimate = thinkingAdjustedEstimate(session)

  // When only estimate: show estimate (adjusted for thinking if detected)
  const primaryCost = hasApi ? session.apiTotalCost! : adjustedEstimate

  return (
    <tr className="border-b border-border transition-colors hover:bg-muted/30">
      <td className="px-4 py-3">
        <Link
          to="/$sessionId"
          params={{ sessionId: session.sessionId }}
          className="font-medium text-foreground hover:text-primary hover:underline"
        >
          {session.sessionId}
        </Link>
        <div className="mt-0.5 text-sm text-foreground/70">
          {session.projectName}
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        <code className="rounded bg-accent px-1.5 py-0.5 text-xs">
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
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1.5">
            <span className="text-sm text-muted-foreground">
              {formatCost(primaryCost)}
            </span>
            {session.hasThinking && (
              <span className="inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-amber-400">
                THINK
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
        >
          View
        </Link>
      </td>
    </tr>
  )
}
