"use client"

import { useState } from "react"
import type { Subagent, ToolCall } from "claude-timeline-types"
import { cn, formatTokens, formatDuration, formatCost, modelTier } from "@/lib/utils"
import { ToolCallList } from "./tool-call"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubagentTimelineStepProps {
  /** Subagents spawned at this turn (single or parallel group) */
  subagents: Subagent[]
  /** Global step index for labeling */
  stepIndex: number
  className?: string
}

// ---------------------------------------------------------------------------
// Agent type badge colors
// ---------------------------------------------------------------------------

const agentTypeStyles: Record<string, string> = {
  Explore: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  "general-purpose": "bg-sky-500/15 text-sky-400 border-sky-500/30",
}

function getAgentTypeStyle(agentType?: string): string {
  if (!agentType) return "bg-muted text-muted-foreground border-border/50"
  return agentTypeStyles[agentType] ?? "bg-muted text-muted-foreground border-border/50"
}

// ---------------------------------------------------------------------------
// SubagentTimelineStep (main export)
// ---------------------------------------------------------------------------

export function SubagentTimelineStep({
  subagents,
  stepIndex,
  className,
}: SubagentTimelineStepProps) {
  if (subagents.length === 0) return null

  const isParallel = subagents.length > 1 && subagents.some((s) => s.isParallel)

  return (
    <div className={cn("relative ml-2", className)}>
      {/* Vertical connector line */}
      <div className="absolute left-0 top-0 bottom-0 w-px border-l-2 border-dashed border-muted-foreground/30" />

      {/* Step label */}
      <div className="relative pl-4 pb-1">
        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-bold text-primary">
          S{stepIndex}
        </span>
        <span className="ml-2 text-xs text-muted-foreground">
          {subagents.length === 1 ? "Subagent" : `${subagents.length} subagents`}
        </span>
        {isParallel && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
            ⚡ parallel
          </span>
        )}
      </div>

      {/* Subagent cards */}
      <div className="relative pl-4 space-y-1">
        {subagents.map((sub, i) => (
          <SubagentCard key={sub.id} subagent={sub} isLast={i === subagents.length - 1} />
        ))}
      </div>

      {/* Bottom arrow connector */}
      <div className="relative pl-0 pt-1">
        <svg
          className="h-4 w-4 -ml-2 text-muted-foreground/50"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SubagentCard — individually collapsible
// ---------------------------------------------------------------------------

interface SubagentCardProps {
  subagent: Subagent
  isLast: boolean
}

function SubagentCard({ subagent, isLast: _isLast }: SubagentCardProps) {
  const [expanded, setExpanded] = useState(false)

  const totalTokens = subagent.totalTokens
    ? subagent.totalTokens.inputTokens +
      subagent.totalTokens.outputTokens +
      subagent.totalTokens.cacheReadTokens +
      subagent.totalTokens.cacheCreation5mTokens +
      subagent.totalTokens.cacheCreation1hTokens
    : 0

  const outputTokens = subagent.totalTokens?.outputTokens ?? 0

  const durationMs =
    subagent.startTime && subagent.endTime
      ? new Date(subagent.endTime).getTime() - new Date(subagent.startTime).getTime()
      : 0

  // Build synthetic turns from messages for the expanded timeline
  const turns = buildSubagentTurns(subagent)

  return (
    <div
      className={cn(
        "relative rounded-lg border bg-card text-card-foreground shadow-sm transition-colors",
        expanded ? "border-border" : "border-border/50 hover:border-border",
      )}
    >
      {/* Horizontal connector from vertical line */}
      <div className="absolute -left-4 top-5 w-4 border-t-2 border-dashed border-muted-foreground/30" />

      {/* Header — clickable */}
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        {/* Chevron */}
        <svg
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" />
        </svg>

        {/* Diamond icon */}
        <span className="text-muted-foreground/60">◆</span>

        {/* Agent type badge */}
        {subagent.agentType && (
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-semibold",
              getAgentTypeStyle(subagent.agentType),
            )}
          >
            {subagent.agentType}
          </span>
        )}

        {/* Description */}
        <span className="flex-1 truncate text-sm font-medium text-foreground/80">
          {subagent.description}
        </span>

        {/* Model */}
        {subagent.model && (
          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-xs font-mono model-${modelTier(subagent.model)}`}>
            {subagent.model}
          </span>
        )}

        {/* Status badge */}
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-semibold",
            subagent.status === "completed"
              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
              : subagent.status === "failed"
                ? "bg-red-500/15 text-red-400 border-red-500/30"
                : "bg-blue-500/15 text-blue-400 border-blue-500/30",
          )}
        >
          {subagent.status === "completed" ? "Done" : subagent.status}
        </span>
      </button>

      {/* Summary line (always visible) */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 pb-2 text-xs text-muted-foreground">
        <span className="font-mono">{subagent.turnCount} turns</span>
        <span className="text-border/40">·</span>
        <span className="font-mono">{formatTokens(totalTokens)} tokens</span>
        <span className="text-border/40">·</span>
        <span className="font-mono">{formatTokens(outputTokens)} out</span>
        {durationMs > 0 && (
          <>
            <span className="text-border/40">·</span>
            <span>{formatDuration(durationMs)}</span>
          </>
        )}
        {subagent.totalCost !== undefined && subagent.totalCost > 0 && (
          <>
            <span className="text-border/40">·</span>
            <span className="font-medium text-emerald-500">{formatCost(subagent.totalCost)}</span>
          </>
        )}
      </div>

      {/* Expanded: subagent's own timeline */}
      {expanded && turns.length > 0 && (
        <div className="border-t border-border/50 px-3 py-2">
          <div className="space-y-0.5 ml-1 pl-3 border-l border-border/30">
            {turns.map((turn, i) => (
              <SubagentTurnRow key={`${turn.timestamp}-${i}`} turn={turn} index={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SubagentTurnRow — single turn inside expanded subagent
// ---------------------------------------------------------------------------

function SubagentTurnRow({ turn, index }: { turn: SyntheticTurn; index: number }) {
  const [expanded, setExpanded] = useState(false)

  const totalCtx =
    turn.tokenUsage.inputTokens +
    turn.tokenUsage.cacheReadTokens +
    turn.tokenUsage.cacheCreation5mTokens +
    turn.tokenUsage.cacheCreation1hTokens

  return (
    <div className="py-1 px-1 rounded hover:bg-muted/20 transition-colors">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {/* Turn badge */}
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
          T{index + 1}
        </span>

        {/* Tool pills or text indicator */}
        {turn.toolCalls.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="cursor-pointer shrink-0 flex items-center gap-1"
          >
            {turn.toolCalls.map((tc, i) => (
              <span
                key={i}
                className="rounded-md border border-orange-500/20 bg-orange-500/10 px-1.5 py-0.5 text-xs font-medium text-orange-400"
              >
                {tc.name}
              </span>
            ))}
            <svg
              className={cn(
                "h-3 w-3 text-muted-foreground transition-transform",
                expanded && "rotate-90",
              )}
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        ) : turn.text ? (
          <span className="text-xs text-muted-foreground/70 truncate max-w-[300px]">
            <span className="inline-block rounded bg-muted px-1 py-0.5 text-[0.625rem] font-semibold text-muted-foreground mr-1">
              text
            </span>
            {turn.text}
          </span>
        ) : (
          <span className="text-[10px] italic text-muted-foreground">processing…</span>
        )}

        {/* Metrics */}
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground ml-auto">
          {formatTokens(totalCtx)} ctx
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {formatTokens(turn.tokenUsage.outputTokens)} out
        </span>
      </div>

      {/* Expanded tool details */}
      {expanded && turn.toolCalls.length > 0 && (
        <div className="ml-6 mt-1 rounded-md border border-orange-500/20 bg-orange-500/5 p-2">
          <ToolCallList toolCalls={turn.toolCalls as ToolCall[]} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Synthetic turn builder — converts subagent messages to displayable turns
// ---------------------------------------------------------------------------

interface SyntheticTurn {
  timestamp: string
  tokenUsage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreation5mTokens: number
    cacheCreation1hTokens: number
  }
  toolCalls: Array<{ name: string; input: Record<string, unknown>; toolUseId: string }>
  text: string | null
}

/**
 * Build synthetic turns from subagent messages for the expanded timeline view.
 * Groups consecutive assistant messages and attaches tool calls.
 */
function buildSubagentTurns(subagent: Subagent): SyntheticTurn[] {
  if (!subagent.messages || subagent.messages.length === 0) return []

  const turns: SyntheticTurn[] = []
  const toolCallsByIndex = new Map<number, Array<{ name: string; input: Record<string, unknown>; toolUseId: string }>>()

  // Map tool calls to their closest message by timestamp
  if (subagent.toolCalls) {
    for (const tc of subagent.toolCalls) {
      if (!tc.timestamp) continue
      const tcTime = new Date(tc.timestamp).getTime()
      let bestIdx = -1
      let bestDiff = Number.MAX_VALUE
      for (let i = 0; i < subagent.messages.length; i++) {
        const msg = subagent.messages[i]!
        if (!msg.timestamp) continue
        const msgTime = new Date(msg.timestamp).getTime()
        const diff = Math.abs(msgTime - tcTime)
        if (diff < bestDiff && diff < 5000) {
          bestDiff = diff
          bestIdx = i
        }
      }
      if (bestIdx >= 0) {
        let arr = toolCallsByIndex.get(bestIdx)
        if (!arr) {
          arr = []
          toolCallsByIndex.set(bestIdx, arr)
        }
        arr.push({ name: tc.name, input: tc.input, toolUseId: tc.toolUseId })
      }
    }
  }

  for (let i = 0; i < subagent.messages.length; i++) {
    const msg = subagent.messages[i]!
    // Only show assistant messages as turns
    if (msg.type !== "assistant") continue

    // Extract text content
    let text: string | null = null
    for (const block of msg.content) {
      if (block.type === "text" && "text" in block && block.text) {
        if (!block.text.startsWith('{"type":"thinking"')) {
          text = block.text
          break
        }
      }
    }

    // Get tool calls for this message
    const toolCalls = toolCallsByIndex.get(i) ?? []

    // Skip empty turns (no text, no tools)
    if (!text && toolCalls.length === 0) continue

    turns.push({
      timestamp: msg!.timestamp ?? new Date().toISOString(),
      tokenUsage: {
        inputTokens: 0, // Not available per-message in subagent data
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
      },
      toolCalls,
      text,
    })
  }

  return turns
}
