import type { SessionMetadata } from "@timeline/types"
import { Link } from "@tanstack/react-router"
import { formatTokens } from "@/lib/utils"

interface SessionListRowProps {
  session: SessionMetadata
}

function formatTime(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt)
  if (!endedAt) {
    return start.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
  }
  const end = new Date(endedAt)
  const diffMs = end.getTime() - start.getTime()
  const seconds = Math.floor(diffMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

export function SessionListRow({ session }: SessionListRowProps) {
  return (
    <tr className="border-b border-border transition-colors hover:bg-surface-2/30">
      <td className="px-4 py-3">
        <Link
          to="/$sessionId"
          params={{ sessionId: session.sessionId }}
          className="font-medium text-text-primary hover:text-accent-blue hover:underline"
        >
          {session.projectName}
        </Link>
      </td>
      <td className="px-4 py-3 text-text-secondary">
        <code className="rounded bg-surface-3 px-1.5 py-0.5 text-xs">
          {session.model}
        </code>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
        {session.turnCount}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
        {formatTokens(
          (session.totalTokens?.inputTokens ?? 0) +
            (session.totalTokens?.outputTokens ?? 0),
        )}
      </td>
      <td className="px-4 py-3 text-text-secondary">
        {formatTime(session.startTime, session.endTime)}
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            session.isOngoing
              ? "bg-accent-blue/15 text-accent-blue"
              : "bg-accent-green/15 text-accent-green"
          }`}
        >
          {session.isOngoing ? "ongoing" : "completed"}
        </span>
      </td>
    </tr>
  )
}
