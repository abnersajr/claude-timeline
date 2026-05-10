"use client"

import { useState } from "react"
import type { Turn, TurnPricing } from "@timeline/types"
import { cn, formatCost, formatTimestamp } from "@/lib/utils"
import { TokenBadgeGroup } from "./token-badge"
import { ToolCallList } from "./tool-call"

interface TurnCardProps {
  turn: Turn
  pricing?: TurnPricing
  index: number
  className?: string
}

/** Inline expandable message preview */
function MessagePreview({
  messages,
}: { messages: Turn["messages"] }) {
  const [expanded, setExpanded] = useState(false)
  const visibleMessages = expanded ? messages : messages.slice(0, 2)
  const hiddenCount = messages.length - 2

  return (
    <div className="space-y-1">
      {visibleMessages.map((msg, i) => {
        const textBlock = msg.content.find((c) => c.type === "text")
        const preview =
          textBlock && "text" in textBlock
            ? textBlock.text.slice(0, expanded ? 500 : 120)
            : `[${msg.type} message]`

        return (
          <div key={i} className="flex items-start gap-2">
            <span
              className={cn(
                "mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-[9px] font-bold",
                msg.type === "user"
                  ? "bg-accent-blue/15 text-accent-blue"
                  : msg.type === "assistant"
                    ? "bg-accent-green/15 text-accent-green"
                    : "bg-surface-3 text-text-muted",
              )}
            >
              {msg.type === "user" ? "U" : msg.type === "assistant" ? "A" : "S"}
            </span>
            <p className="min-w-0 flex-1 truncate text-xs text-text-secondary">
              {preview}
              {!expanded && preview.length >= 120 && "…"}
            </p>
          </div>
        )
      })}
      {!expanded && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs text-text-muted transition-colors hover:text-text-secondary"
        >
          +{hiddenCount} more message{hiddenCount > 1 ? "s" : ""}
        </button>
      )}
    </div>
  )
}

/** Tool call name pills shown in collapsed state */
function ToolCallPills({ toolCalls }: { toolCalls: Turn["toolCalls"] }) {
  const maxShow = 6
  const visible = toolCalls.slice(0, maxShow)
  const hidden = toolCalls.length - maxShow

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((tc) => (
        <span
          key={tc.toolUseId}
          className={cn(
            "rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-text-secondary",
            tc.isTask &&
              "border border-accent-purple/30 bg-accent-purple/10 text-accent-purple",
          )}
        >
          {tc.name}
        </span>
      ))}
      {hidden > 0 && (
        <span className="text-[10px] text-text-muted">
          +{hidden} more
        </span>
      )}
    </div>
  )
}

export function TurnCard({ turn, pricing, index, className }: TurnCardProps) {
  const [showToolDetails, setShowToolDetails] = useState(false)
  const toolCallCount = turn.toolCalls.length
  const messageCount = turn.messages.length
  const hasToolCalls = toolCallCount > 0

  return (
    <div
      className={cn(
        "group relative rounded-lg border border-border bg-surface-1 transition-colors hover:border-border-subtle",
        className,
      )}
    >
      {/* Turn header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Turn number badge */}
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-3 text-xs font-bold text-text-muted">
            {index + 1}
          </span>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">
              Turn {index + 1}
            </span>
            {turn.model && (
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-muted">
                {turn.model}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Cost */}
          {pricing && (
            <span className="text-xs font-medium text-brand-400">
              {formatCost(pricing.totalCost)}
            </span>
          )}
          {/* Timestamp */}
          <span className="text-xs text-text-muted">
            {formatTimestamp(turn.timestamp)}
          </span>
        </div>
      </div>

      {/* Turn body */}
      <div className="p-4 space-y-3">
        {/* Messages */}
        {messageCount > 0 && <MessagePreview messages={turn.messages} />}

        {/* Tool calls summary / detail toggle */}
        {hasToolCalls && (
          <div>
            {!showToolDetails ? (
              <button
                type="button"
                onClick={() => setShowToolDetails(true)}
                className="w-full text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
                    Tool Calls ({toolCallCount})
                  </span>
                  <span className="text-[10px] text-text-muted">
                    · click to expand
                  </span>
                </div>
                <div className="mt-1.5">
                  <ToolCallPills toolCalls={turn.toolCalls} />
                </div>
              </button>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={() => setShowToolDetails(false)}
                  className="mb-1 text-[10px] font-medium uppercase tracking-wider text-text-muted transition-colors hover:text-text-secondary"
                >
                  Collapse tool calls
                </button>
                <ToolCallList toolCalls={turn.toolCalls} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Token footer */}
      <div className="flex items-center justify-between border-t border-border/50 px-4 py-2.5">
        <TokenBadgeGroup
          inputTokens={turn.tokenUsage.inputTokens}
          outputTokens={turn.tokenUsage.outputTokens}
          cacheReadTokens={turn.tokenUsage.cacheReadTokens}
          cacheCreationTokens={turn.cacheCreationTokensThisTurn}
        />
        {messageCount > 0 && (
          <span className="text-[10px] text-text-muted">
            {messageCount} message{messageCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  )
}
