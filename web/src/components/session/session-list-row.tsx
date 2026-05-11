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



export function SessionListRow({ session }: SessionListRowProps) {
  return (
    <tr className="border-b border-border transition-colors hover:bg-muted/30">
      <td className="px-4 py-3">
        <Link
          to="/$sessionId"
          params={{ sessionId: session.sessionId }}
          className="font-medium text-foreground hover:text-primary hover:underline"
        >
          {session.projectName}
        </Link>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        <code className="rounded bg-accent px-1.5 py-0.5 text-xs">
          {session.model}
        </code>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
        {session.turnCount}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
        {formatCost(session.totalCostEstimate)}
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
