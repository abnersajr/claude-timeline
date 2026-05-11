"use client"

import { useState } from "react"
import type {
  ConversationGroup,
  Message,
  Turn,
  TurnPricing,
  Subagent,
} from "@timeline/types"
import {
  cn,
  formatTimestamp,
  formatCost,
  formatDuration,
  formatTokens,
} from "@/lib/utils"
import { TokenBadgeGroup } from "./token-badge"
import { ToolCallList, ToolCallPills } from "./tool-call"
import { SubagentCard } from "./subagent-card"
import { Timeline } from "./timeline"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChatTimelineProps {
  conversationGroups: ConversationGroup[]
  turns: Turn[]
  turnsPricing: TurnPricing[]
  subagents?: Subagent[]
  className?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the first text content from a message, skipping thinking blocks */
function getMessageText(message: Message): string | null {
  for (const block of message.content) {
    if (block.type === "text" && "text" in block && block.text) {
      if (block.text.startsWith('{"type":"thinking"')) continue
      return block.text
    }
  }
  return null
}

/**
 * Clean user message text for display.
 * - Command messages: extracts `/command-name` from XML tags
 * - Regular text: returned as-is
 */
function cleanUserText(raw: string): string {
  const cmdMatch = raw.match(/<command-name>([\s\S]*?)<\/command-name>/)
  if (cmdMatch) return cmdMatch[1].trim()

  const msgMatch = raw.match(/<command-message>([\s\S]*?)<\/command-message>/)
  if (msgMatch) return msgMatch[1].trim()

  return raw
}

/** Check if a turn has a user message with text content */
function hasUserText(turn: Turn): boolean {
  return turn.messages.some(
    (m) => m.type === "user" && m.content.some((c) => c.type === "text" && c.text && !c.text.startsWith('{"type":"thinking"')),
  )
}

/** Check if a turn has assistant text content (not just tool_use/tool_result) */
function hasAssistantText(turn: Turn): boolean {
  return turn.messages.some(
    (m) => m.type === "assistant" && m.content.some((c) => c.type === "text" && c.text && !c.text.startsWith('{"type":"thinking"')),
  )
}

/** Get total context tokens for a turn (what the model actually processed) */
function totalContext(turn: Turn): number {
  return (
    turn.tokenUsage.inputTokens +
    turn.tokenUsage.cacheReadTokens +
    turn.tokenUsage.cacheCreation5mTokens +
    turn.tokenUsage.cacheCreation1hTokens
  )
}

/** Extract user text from a turn */
function getUserText(turn: Turn): string | null {
  for (const msg of turn.messages) {
    if (msg.type === "user") {
      const text = getMessageText(msg)
      if (text) return cleanUserText(text)
    }
  }
  return null
}

/** Extract assistant text from a turn */
function getAssistantText(turn: Turn): string | null {
  for (const msg of turn.messages) {
    if (msg.type === "assistant") {
      const text = getMessageText(msg)
      if (text) return text
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Turn type classification
// ---------------------------------------------------------------------------

type TurnKind = "user" | "agent-output" | "agent-turn"

function classifyTurn(turn: Turn): TurnKind {
  if (hasUserText(turn)) return "user"
  if (hasAssistantText(turn) && turn.toolCalls.length === 0) return "agent-output"
  return "agent-turn"
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** User message bubble (right-aligned) */
function UserBubble({ turn, index }: { turn: Turn; index: number }) {
  const text = getUserText(turn)
  if (!text) return null

  const isCommand = text.startsWith("/")

  return (
    <div className="flex flex-col items-end">
      {/* Header */}
      <div className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        <svg className="h-4 w-4" viewBox="0 0 256 256" fill="currentColor">
          <path d="M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c19.87-34.56,51.68-56,87.07-56s67.2,21.44,87.07,56a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z" />
        </svg>
        <span className="font-semibold text-foreground">You</span>
        <span>{formatTimestamp(turn.timestamp)}</span>
      </div>

      {/* Bubble */}
      <div className="relative">
        <div className={cn("absolute -top-1.5 left-3 h-3 w-3 rotate-45 border-l border-t", isCommand ? "border-primary/30 bg-primary/15" : "border-primary/20 bg-primary/10")} />
        <div
          className={cn(
            "relative max-w-[70%] rounded-2xl rounded-tl-md border px-4 py-2.5 font-mono text-[15px] max-sm:max-w-full",
            isCommand ? "border-primary/30 bg-primary/15 text-primary-foreground" : "border-primary/20 bg-primary/10 text-foreground",
          )}
        >
          <p className="whitespace-pre-wrap break-words">{text}</p>
        </div>
      </div>
    </div>
  )
}

/** Agent output bubble (left-aligned, text to user) */
function AgentOutputBubble({ turn, index, pricing }: { turn: Turn; index: number; pricing?: TurnPricing }) {
  const [showTools, setShowTools] = useState(false)
  const text = getAssistantText(turn)
  const hasTools = turn.toolCalls.length > 0
  const ctx = totalContext(turn)

  return (
    <div className="flex flex-col items-start">
      {/* Header */}
      <div className="mb-1 flex w-full items-center justify-between text-sm text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <svg className="h-4 w-4" viewBox="0 0 256 256" fill="currentColor">
            <path d="M198,112a6,6,0,0,1-6,6H168a14,14,0,0,1-14-14V80a6,6,0,0,1,12,0v24a2,2,0,0,0,2,2h24A6,6,0,0,1,198,112ZM128,26a94,94,0,1,0,94,94A94.11,94.11,0,0,0,128,26Zm82,94a82,82,0,1,1-82-82A82.09,82.09,0,0,1,210,120ZM176,160a6,6,0,0,1-6,6H146a14,14,0,0,1-14-14V128a6,6,0,0,1,12,0v24a2,2,0,0,0,2,2h24A6,6,0,0,1,176,160Zm-56,0a6,6,0,0,1-6,6H90a14,14,0,0,1-14-14V128a6,6,0,0,1,12,0v24a2,2,0,0,0,2,2h24A6,6,0,0,1,120,160Z" />
          </svg>
          <span className="font-semibold text-foreground">Claude</span>
          <span className="rounded bg-accent px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">T{index + 1}</span>
          {turn.model && <span className="text-xs text-muted-foreground">{turn.model}</span>}
        </div>
        <span>{formatTimestamp(turn.timestamp)}</span>
      </div>

      {/* Bubble */}
      <div className="relative">
        <div className="absolute -top-1.5 right-3 h-3 w-3 rotate-45 border-r border-t border-border/50 bg-card" />
        <div className="relative max-w-[85%] rounded-2xl rounded-tr-md border border-border/50 bg-card px-4 py-2.5 shadow-sm max-sm:max-w-full">
          {/* Text */}
          {text && (
            <p className="whitespace-pre-wrap break-words font-mono text-[15px] text-foreground/90">{text}</p>
          )}

          {/* Tool calls */}
          {hasTools && (
            <div className={cn("border-border/30 pt-2", text && "mt-2.5 border-t")}>
              {!showTools ? (
                <button type="button" onClick={() => setShowTools(true)} className="w-full text-left cursor-pointer">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ToolCallPills toolCalls={turn.toolCalls} />
                    <span className="text-sm text-primary hover:text-primary/80 transition-colors">· click to expand</span>
                  </div>
                </button>
              ) : (
                <div>
                  <button type="button" onClick={() => setShowTools(false)} className="mb-1.5 text-sm font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer">
                    Collapse
                  </button>
                  <ToolCallList toolCalls={turn.toolCalls} />
                </div>
              )}
            </div>
          )}

          {/* Subagents */}
          {turn.toolCalls.filter((tc) => tc.isTask).map((tc) => (
            <SubagentCard key={tc.toolUseId} subagent={{
              id: tc.toolUseId,
              description: tc.taskDescription || tc.name,
              status: "completed",
              turns: 0,
              tokens: 0,
              durationMs: 0,
            }} />
          ))}
        </div>
      </div>

      {/* Token/cost footer */}
      <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
        <span className="font-mono">Context {formatTokens(ctx)}</span>
        <span className="font-mono">Out {formatTokens(turn.tokenUsage.outputTokens)}</span>
        {pricing && pricing.totalCost > 0 && (
          <span className="font-medium text-emerald-500">{formatCost(pricing.totalCost)}</span>
        )}
      </div>
    </div>
  )
}

/** Agent processing turn (left-aligned, compact tool card) */
function AgentTurnCard({ turn, index, pricing }: { turn: Turn; index: number; pricing?: TurnPricing }) {
  const [showTools, setShowTools] = useState(false)
  const hasTools = turn.toolCalls.length > 0
  const ctx = totalContext(turn)

  return (
    <div className="flex flex-col items-start">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">T{index + 1}</span>
        {hasTools && (
          <button type="button" onClick={() => setShowTools(!showTools)} className="cursor-pointer">
            <div className="flex items-center gap-1.5">
              <ToolCallPills toolCalls={turn.toolCalls} />
              <span className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                {showTools ? "▲" : "▼"}
              </span>
            </div>
          </button>
        )}
        {!hasTools && (
          <span className="text-sm italic text-muted-foreground">processing…</span>
        )}
        <span className="font-mono text-sm">{formatTokens(ctx)} ctx</span>
        <span className="font-mono text-sm">{formatTokens(turn.tokenUsage.outputTokens)} out</span>
        {pricing && pricing.totalCost > 0 && (
          <span className="font-mono text-sm text-emerald-500">{formatCost(pricing.totalCost)}</span>
        )}
        <span className="text-sm">{formatTimestamp(turn.timestamp)}</span>
      </div>

      {showTools && hasTools && (
        <div className="mt-1 ml-6 w-full max-w-[85%] rounded-md border border-border/30 bg-muted/20 p-2">
          <ToolCallList toolCalls={turn.toolCalls} />
        </div>
      )}
    </div>
  )
}

/** Group footer with aggregated stats */
function GroupFooter({ turns, turnsPricing }: { turns: Turn[]; turnsPricing: TurnPricing[] }) {
  let totalCtx = 0
  let totalOut = 0
  let totalCost = 0
  let toolCount = 0

  for (let i = 0; i < turns.length; i++) {
    totalCtx += totalContext(turns[i])
    totalOut += turns[i].tokenUsage.outputTokens
    toolCount += turns[i].toolCalls.length
    if (turnsPricing[i]) totalCost += turnsPricing[i].totalCost
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border/30 pt-2 text-sm text-muted-foreground">
      <span className="font-mono">Total context: {formatTokens(totalCtx)}</span>
      <span className="font-mono">Output: {formatTokens(totalOut)}</span>
      <span className="font-mono">{toolCount} tool call{toolCount !== 1 ? "s" : ""}</span>
      {totalCost > 0 && <span className="font-medium text-emerald-500">{formatCost(totalCost)}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ChatTimeline({
  conversationGroups,
  turns,
  turnsPricing,
  subagents,
  className,
}: ChatTimelineProps) {
  if (!turns || turns.length === 0) {
    return (
      <div className={cn("py-12 text-center text-muted-foreground", className)}>
        No turns recorded for this session.
      </div>
    )
  }

  // Group turns into interaction groups.
  // A new group starts when a turn has user text.
  const groups: Turn[][] = []
  let current: Turn[] = []

  for (const turn of turns) {
    if (hasUserText(turn) && current.length > 0) {
      groups.push(current)
      current = []
    }
    current.push(turn)
  }
  if (current.length > 0) groups.push(current)

  return (
    <div className={cn("space-y-1", className)}>
      {groups.map((group, gi) => {
        const isLast = gi === groups.length - 1
        const nextGroup = !isLast ? groups[gi + 1] : undefined

        return (
          <div key={group[0].timestamp}>
            {group.map((turn, ti) => {
              const globalIdx = turns.indexOf(turn)
              const kind = classifyTurn(turn)
              const pricing = turnsPricing[globalIdx]

              if (kind === "user") {
                return (
                  <div key={turn.timestamp} className="mb-2">
                    <UserBubble turn={turn} index={globalIdx} />
                  </div>
                )
              }

              if (kind === "agent-output") {
                return (
                  <div key={turn.timestamp} className="mb-2">
                    <AgentOutputBubble turn={turn} index={globalIdx} pricing={pricing} />
                  </div>
                )
              }

              // agent-turn (tool calls, processing)
              return (
                <div key={turn.timestamp} className="mb-1 pl-4">
                  <AgentTurnCard turn={turn} index={globalIdx} pricing={pricing} />
                </div>
              )
            })}

            {/* Group footer */}
            <GroupFooter turns={group} turnsPricing={turnsPricing} />

            {/* Divider between groups */}
            {nextGroup && (
              <div className="flex items-center gap-3 py-3">
                <div className="flex-1 h-px bg-border/40" />
                <span className="text-sm text-muted-foreground/60">
                  {formatTimestamp(nextGroup[0].timestamp)}
                </span>
                <div className="flex-1 h-px bg-border/40" />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
