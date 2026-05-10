import { Database, WifiOff, Inbox } from "lucide-react"

interface EmptyStateProps {
  icon?: "inbox" | "database" | "wifi-off"
  title: string
  description: string
  action?: {
    label: string
    onClick: () => void
  }
}

const icons = {
  inbox: Inbox,
  database: Database,
  "wifi-off": WifiOff,
}

export function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
}: EmptyStateProps) {
  const Icon = icons[icon]

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-16 text-center">
      <div className="rounded-full bg-surface-2 p-4">
        <Icon className="h-8 w-8 text-text-muted" />
      </div>

      <div className="space-y-1">
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        <p className="max-w-sm text-sm text-text-muted">{description}</p>
      </div>

      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-3"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

export function NoSessionsEmpty({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      icon="database"
      title="No sessions found"
      description="No Claude Code sessions were detected. Start a session in Claude Code and it will appear here."
      action={
        onRetry
          ? { label: "Refresh", onClick: onRetry }
          : undefined
      }
    />
  )
}

export function ApiUnreachableEmpty({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      icon="wifi-off"
      title="Cannot reach API"
      description="The timeline API server is not responding. Make sure it's running on port 3001."
      action={
        onRetry
          ? { label: "Retry connection", onClick: onRetry }
          : undefined
      }
    />
  )
}
