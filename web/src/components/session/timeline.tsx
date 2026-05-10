import type { Turn, TurnPricing } from "@timeline/types"
import { cn, formatCost, formatTokens, formatTimestamp } from "@/lib/utils"

interface TimelineProps {
  turns: Turn[]
  turnsPricing: TurnPricing[]
  className?: string
}

interface TurnCardProps {
  turn: Turn
  pricing?: TurnPricing
  index: number
}

function TokenPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-xs text-text-secondary">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  )
}

function TurnCard({ turn, pricing, index }: TurnCardProps) {
  const toolCallCount = turn.toolCalls.length
  const messageCount = turn.messages.length
  const hasToolCalls = toolCallCount > 0

  return (
    <div className="group relative rounded-lg border border-border bg-surface-1 p-4 transition-colors hover:border-border-subtle">
      {/* Turn number + timestamp */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-3 text-xs font-bold text-text-muted">
            {index + 1}
          </span>
          <div>
            <span className="text-sm font-medium text-text-primary">
              Turn {index + 1}
            </span>
            {turn.model && (
              <span className="ml-2 text-xs text-text-muted">
                {turn.model}
              </span>
            )}
          </div>
        </div>
        <span className="text-xs text-text-muted">
          {formatTimestamp(turn.timestamp)}
        </span>
      </div>

      {/* Messages preview */}
      {messageCount > 0 && (
        <div className="mb-3 space-y-1">
          {turn.messages.slice(0, 2).map((msg, i) => {
            const textBlock = msg.content.find((c) => c.type === "text")
            const preview =
              textBlock && "text" in textBlock
                ? textBlock.text.slice(0, 120)
                : `[${msg.type} message]`
            return (
              <p
                key={i}
                className="truncate text-xs text-text-secondary"
              >
                {preview}
                {preview.length >= 120 && "…"}
              </p>
            )
          })}
          {messageCount > 2 && (
            <p className="text-xs text-text-muted">
              +{messageCount - 2} more message{messageCount - 2 > 1 ? "s" : ""}
            </p>
          )}
        </div>
      )}

      {/* Tool calls summary */}
      {hasToolCalls && (
        <div className="mb-3">
          <span className="text-xs font-medium text-text-muted">
            Tool Calls:
          </span>
          <div className="mt-1 flex flex-wrap gap-1">
            {turn.toolCalls.slice(0, 5).map((tc) => (
              <span
                key={tc.toolUseId}
                className={cn(
                  "rounded bg-surface-3 px-1.5 py-0.5 text-xs text-text-secondary",
                  tc.isTask && "border border-accent-purple/30 text-accent-purple",
                )}
              >
                {tc.name}
              </span>
            ))}
            {toolCallCount > 5 && (
              <span className="text-xs text-text-muted">
                +{toolCallCount - 5} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Token usage + cost */}
      <div className="flex flex-wrap items-center gap-2">
        <TokenPill
          label="in"
          value={formatTokens(turn.tokenUsage.inputTokens)}
        />
        <TokenPill
          label="out"
          value={formatTokens(turn.tokenUsage.outputTokens)}
        />
        {turn.tokenUsage.cacheReadTokens > 0 && (
          <TokenPill
            label="cache"
            value={formatTokens(turn.tokenUsage.cacheReadTokens)}
          />
        )}
        {pricing && (
          <span className="ml-auto text-xs font-medium text-brand-400">
            {formatCost(pricing.totalCost)}
          </span>
        )}
      </div>
    </div>
  )
}

export function Timeline({ turns, turnsPricing, className }: TimelineProps) {
  if (turns.length === 0) {
    return (
      <div className={cn("py-12 text-center text-text-muted", className)}>
        No turns recorded for this session.
      </div>
    )
  }

  return (
    <div className={cn("space-y-3", className)}>
      <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
        Timeline ({turns.length} turns)
      </h3>
      {turns.map((turn, i) => (
        <TurnCard
          key={turn.timestamp}
          turn={turn}
          pricing={turnsPricing[i]}
          index={i}
        />
      ))}
    </div>
  )
}
