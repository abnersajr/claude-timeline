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

/** Collapsible thinking block with help popover */
function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  return (
    <div className="mt-1 rounded border border-amber-500/20 bg-amber-500/5">
      <div className="flex items-center gap-2 px-2 py-1">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[10px] text-amber-400/80"
        >
          💭 Thinking
          <span className="text-[8px]">{expanded ? "▼" : "▶"}</span>
        </button>
        <div className="relative">
          <button
            type="button"
            onMouseEnter={() => setShowHelp(true)}
            onMouseLeave={() => setShowHelp(false)}
            className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/20 text-[8px] text-amber-400"
          >
            ?
          </button>
          {showHelp && (
            <div className="absolute bottom-full left-0 z-50 mb-1 w-48 rounded border border-border bg-card p-2 text-[10px] text-muted-foreground shadow-lg">
              Internal model reasoning — not visible to users. Click to expand.
            </div>
          )}
        </div>
      </div>
      {expanded && (
        <pre className="max-h-48 overflow-auto border-t border-amber-500/10 bg-amber-500/5 p-2 font-mono text-[10px] text-amber-200/70 whitespace-pre-wrap">
          {text}
        </pre>
      )}
    </div>
  )
}

/** Chat-like message bubbles */
function MessagePreview({
  messages,
}: { messages: Turn["messages"] }) {
  const [expanded, setExpanded] = useState(false)
  const visibleMessages = expanded ? messages : messages.slice(0, 2)
  const hiddenCount = messages.length - 2

  const filtered = visibleMessages.filter((m) => m.type !== "attachment")

  return (
    <div className="space-y-2">
      {filtered.map((msg, i) => {
        const textBlock = msg.content.find((c) => c.type === "text")
        const hasThinking =
          textBlock &&
          "text" in textBlock &&
          textBlock.text.startsWith('{"type":"thinking"')
        const preview =
          textBlock && "text" in textBlock && !hasThinking
            ? textBlock.text.slice(0, expanded ? 500 : 120)
            : null

        const isUser = msg.type === "user"
        const isAssistant = msg.type === "assistant"
        const isSystem = msg.type === "system"

        return (
          <div
            key={i}
            className={cn(
              "flex",
              isUser && "justify-start",
              isAssistant && "justify-end",
              isSystem && "justify-center",
            )}
          >
            <div
              className={cn(
                "max-w-[70%] rounded-lg px-3 py-2 text-xs",
                isUser && "bg-blue-500/10",
                isAssistant && "bg-emerald-500/10",
                isSystem && "bg-muted max-w-full",
                // responsive: full width on small screens
                "max-sm:max-w-full",
              )}
            >
              {/* Role badge */}
              <div
                className={cn(
                  "mb-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  isUser && "bg-blue-500/20 text-blue-200",
                  isAssistant && "bg-emerald-500/20 text-emerald-200",
                  isSystem && "bg-muted text-muted-foreground",
                )}
              >
                {isUser && "👤 User"}
                {isAssistant && "🤖 Assistant"}
                {isSystem && "⚙️ System"}
              </div>

              {/* Thinking block */}
              {hasThinking && <ThinkingBlock text={textBlock.text} />}

              {/* Message text */}
              {preview && (
                <p className="mt-1 whitespace-pre-wrap break-words text-foreground/90">
                  {preview}
                  {!expanded && preview.length >= 120 && "…"}
                </p>
              )}
            </div>
          </div>
        )
      })}
      {!expanded && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
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
            "rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] text-orange-400",
            tc.isTask &&
              "border border-violet-500/30 bg-violet-500/10 text-violet-400",
          )}
        >
          {tc.name}
        </span>
      ))}
      {hidden > 0 && (
        <span className="text-[10px] text-muted-foreground">
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
        "group relative rounded-lg border border-border bg-card transition-colors hover:border-border/80",
        className,
      )}
    >
      {/* Turn header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Turn number badge */}
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-muted-foreground">
            {index + 1}
          </span>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              Turn {index + 1}
            </span>
            {turn.model && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {turn.model}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Cost */}
          {pricing && (
            <span className="text-xs font-medium text-primary">
              {formatCost(pricing.totalCost)}
            </span>
          )}
          {/* Timestamp */}
          <span className="text-xs text-muted-foreground">
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
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Tool Calls ({toolCallCount})
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    · click to expand
                  </span>
                </div>
                <div className="mt-1.5">
                  <ToolCallPills toolCalls={turn.toolCalls} />
                </div>
              </button>
            ) : (
              <div className="rounded-lg bg-muted/30 p-3 border border-border/50">
                <button
                  type="button"
                  onClick={() => setShowToolDetails(false)}
                  className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
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
          <span className="text-[10px] text-muted-foreground">
            {messageCount} message{messageCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  )
}
