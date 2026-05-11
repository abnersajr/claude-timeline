"use client"

import { useState } from "react"
import Markdown from "react-markdown"
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

function getMessageText(message: Message): string | null {
  for (const block of message.content) {
    if (block.type === "text" && "text" in block && block.text) {
      if (block.text.startsWith('{"type":"thinking"')) continue
      return block.text
    }
  }
  return null
}

function cleanUserText(raw: string): string {
  const cmdMatch = raw.match(/<command-name>([\s\S]*?)<\/command-name>/)
  if (cmdMatch) return cmdMatch[1].trim()
  const msgMatch = raw.match(/<command-message>([\s\S]*?)<\/command-message>/)
  if (msgMatch) return msgMatch[1].trim()
  return raw
}

function getUserText(turn: Turn): string | null {
  for (const msg of turn.messages) {
    if (msg.type === "user") {
      const text = getMessageText(msg)
      if (text) return cleanUserText(text)
    }
  }
  return null
}

function getAssistantText(turn: Turn): string | null {
  for (const msg of turn.messages) {
    if (msg.type === "assistant") {
      const text = getMessageText(msg)
      if (text) return text
    }
  }
  return null
}

function totalContext(turn: Turn): number {
  return (
    turn.tokenUsage.inputTokens +
    turn.tokenUsage.cacheReadTokens +
    turn.tokenUsage.cacheCreation5mTokens +
    turn.tokenUsage.cacheCreation1hTokens
  )
}

function hasUserText(turn: Turn): boolean {
  return turn.messages.some(
    (m) => m.type === "user" && m.content.some((c) => c.type === "text" && c.text && !c.text.startsWith('{"type":"thinking"')),
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Group summary bar (top of group) — aggregated totals */
function GroupSummary({ turns, turnsPricing }: { turns: Turn[]; turnsPricing: TurnPricing[] }) {
  let ctx = 0, out = 0, cost = 0, tools = 0
  for (let i = 0; i < turns.length; i++) {
    ctx += totalContext(turns[i])
    out += turns[i].tokenUsage.outputTokens
    tools += turns[i].toolCalls.length
    if (turnsPricing[i]) cost += turnsPricing[i].totalCost
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm text-muted-foreground">
      <span className="font-mono">{formatTokens(ctx)} context</span>
      <span className="text-border/40">·</span>
      <span className="font-mono">{formatTokens(out)} output</span>
      <span className="text-border/40">·</span>
      <span>{tools} tool call{tools !== 1 ? "s" : ""}</span>
      {cost > 0 && (
        <>
          <span className="text-border/40">·</span>
          <span className="font-medium text-emerald-500">{formatCost(cost)}</span>
        </>
      )}
      <span className="ml-auto font-mono">{turns.length} turns</span>
    </div>
  )
}

/** Extract tool_use blocks from messages that weren't captured as toolCalls */
function extractToolUseFromMessages(turn: Turn): Array<{ name: string; input: Record<string, unknown>; toolUseId: string }> {
  const result: Array<{ name: string; input: Record<string, unknown>; toolUseId: string }> = []
  for (const msg of turn.messages) {
    for (const block of msg.content) {
      if (block.type === "tool_use" && "name" in block) {
        result.push({
          name: String(block.name ?? ""),
          input: (block.input as Record<string, unknown>) ?? {},
          toolUseId: String(block.toolUseId ?? block.id ?? ""),
        })
      }
    }
  }
  return result
}

/** Extract tool_result content from messages */
function extractToolResultsFromMessages(turn: Turn): Array<{ content: string; isError?: boolean }> {
  const result: Array<{ content: string; isError?: boolean }> = []
  for (const msg of turn.messages) {
    for (const block of msg.content) {
      if (block.type === "tool_result") {
        result.push({
          content: typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? ""),
          isError: block.isError as boolean | undefined,
        })
      }
    }
  }
  return result
}

/** Turn row — compact inline display for a single turn */
function TurnRow({ turn, index, pricing, isFinalOutput }: { turn: Turn; index: number; pricing?: TurnPricing; isFinalOutput?: boolean }) {
  const [showDetails, setShowDetails] = useState(false)
  const hasTools = turn.toolCalls.length > 0
  const text = getAssistantText(turn)
  const ctx = totalContext(turn)

  // Also check for tool_use/tool_result in message content
  const messageToolUse = extractToolUseFromMessages(turn)
  const messageToolResults = extractToolResultsFromMessages(turn)
  const hasAnyTools = hasTools || messageToolUse.length > 0 || messageToolResults.length > 0

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {/* Turn badge */}
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
          T{index + 1}
        </span>

        {/* Tool pills (clickable to expand Level 2.2) */}
        {hasTools && (
          <button type="button" onClick={() => setShowDetails(!showDetails)} className="cursor-pointer shrink-0 flex items-center gap-1.5">
            <ToolCallPills toolCalls={turn.toolCalls} />
            <span className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {showDetails ? "▲" : "▼"}
            </span>
          </button>
        )}

        {/* Message tool_use indicator (when no extracted tool calls) */}
        {!hasTools && messageToolUse.length > 0 && (
          <button type="button" onClick={() => setShowDetails(!showDetails)} className="cursor-pointer shrink-0 flex items-center gap-1.5">
            {messageToolUse.map((tu, i) => (
              <span key={i} className="rounded-md border border-orange-500/20 bg-orange-500/10 px-2 py-0.5 text-sm font-medium text-orange-400">
                {tu.name}
              </span>
            ))}
            <span className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {showDetails ? "▲" : "▼"}
            </span>
          </button>
        )}

        {/* Message tool_result indicator */}
        {!hasTools && messageToolUse.length === 0 && messageToolResults.length > 0 && (
          <button type="button" onClick={() => setShowDetails(!showDetails)} className="cursor-pointer shrink-0 flex items-center gap-1.5">
            <span className="rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-sm font-medium text-blue-400">
              result
            </span>
            <span className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {showDetails ? "▲" : "▼"}
            </span>
          </button>
        )}

        {/* Processing indicator when nothing else */}
        {!hasAnyTools && !text && (
          <span className="text-sm italic text-muted-foreground">processing…</span>
        )}

        {/* Metrics */}
        <span className="shrink-0 font-mono text-sm text-muted-foreground ml-auto">{formatTokens(ctx)} ctx</span>
        <span className="shrink-0 font-mono text-sm text-muted-foreground">{formatTokens(turn.tokenUsage.outputTokens)} out</span>
        {pricing && pricing.totalCost > 0 && (
          <span className="shrink-0 font-mono text-sm text-emerald-500">{formatCost(pricing.totalCost)}</span>
        )}
      </div>

      {/* Inline text preview (below the row) — skip for final output (shown as bubble) */}
      {text && !isFinalOutput && (
        <div className="mt-1 ml-6 text-sm text-foreground/70 break-words">
          {text.length > 100 ? text.slice(0, 100) + "…" : text}
        </div>
      )}

      {/* Expanded tool details (Level 2.2) */}
      {showDetails && (
        <div className="ml-6 mt-1 space-y-1">
          {/* Extracted tool calls */}
          {hasTools && (
            <div className="rounded-md border border-orange-500/20 bg-orange-500/5 p-2">
              <ToolCallList toolCalls={turn.toolCalls} />
            </div>
          )}

          {/* Message tool_use blocks (not in toolCalls) */}
          {messageToolUse.length > 0 && !hasTools && (
            <div className="rounded-md border border-orange-500/20 bg-orange-500/5 p-2">
              {messageToolUse.map((tu, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-xs font-medium text-orange-400">{tu.name}</span>
                  <span className="font-mono text-xs text-muted-foreground truncate">
                    {JSON.stringify(tu.input).slice(0, 80)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Message tool_result blocks */}
          {messageToolResults.length > 0 && (
            <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-2">
              {messageToolResults.map((tr, i) => (
                <div key={i}>
                  {tr.isError && <span className="text-xs text-red-400 mr-2">error</span>}
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all max-h-24 overflow-auto">
                    {tr.content.length > 200 ? tr.content.slice(0, 200) + "…" : tr.content}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Agent output bubble — the text the user actually sees */
function AgentOutputBubble({ text, turn }: { text: string; turn: Turn }) {
  return (
    <div className="flex flex-col items-end">
      <div className="relative">
        <div className="absolute -top-1.5 right-3 h-3 w-3 rotate-45 border-r border-t border-emerald-500/30 bg-emerald-500/5" />
        <div className="relative max-w-full rounded-2xl rounded-tr-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 max-sm:max-w-full">
          <div className="prose prose-sm prose-invert max-w-none font-mono text-[15px] text-foreground/90 break-words [&_strong]:text-foreground [&_code]:text-emerald-400 [&_code]:bg-emerald-500/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:bg-muted/50 [&_pre]:p-2 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_ul]:my-1 [&_li]:my-0.5">
            <Markdown>{text}</Markdown>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Processing turns (T1–T{n-1}) — wrapped in a single collapsible */
function ProcessingTurns({
  turns,
  turnsPricing,
  firstGlobalIdx,
}: {
  turns: Turn[]
  turnsPricing: TurnPricing[]
  firstGlobalIdx: number
}) {
  const [expanded, setExpanded] = useState(false)

  // Count total tool calls across all processing turns
  let totalTools = 0
  for (const t of turns) totalTools += t.toolCalls.length

  return (
    <div className="rounded-md border border-border/40 bg-muted/10">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <svg
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="font-semibold text-foreground">
          T{firstGlobalIdx + 1}–{firstGlobalIdx + turns.length}
        </span>
        <span>· {turns.length} turn{turns.length !== 1 ? "s" : ""}</span>
        {totalTools > 0 && (
          <span>· {totalTools} tool call{totalTools !== 1 ? "s" : ""}</span>
        )}
        <span className="ml-auto text-xs">{expanded ? "collapse" : "expand"}</span>
      </button>

      {/* Expanded turn rows */}
      {expanded && (
        <div className="space-y-1 border-t border-border/30 px-3 pt-2 pb-2">
          {turns.map((turn, i) => (
            <div key={turn.timestamp}>
              <TurnRow
                turn={turn}
                index={firstGlobalIdx + i}
                pricing={turnsPricing[firstGlobalIdx + i]}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Interaction group container */
function InteractionGroup({
  turns,
  turnsPricing,
}: {
  turns: Turn[]
  turnsPricing: TurnPricing[]
}) {
  // Extract user message from the first turn
  const firstTurn = turns[0]
  const userText = getUserText(firstTurn)

  // Find the last turn with assistant text (the "output" to the user)
  let lastTextIdx = -1
  for (let i = turns.length - 1; i >= 0; i--) {
    if (getAssistantText(turns[i])) {
      lastTextIdx = i
      break
    }
  }

  // Compute global indices
  const firstGlobalIdx = 0 // will be set by caller

  return (
    <div className="rounded-lg border border-border/60 bg-card shadow-sm">
      {/* Group summary at top */}
      <div className="border-b border-border/40">
        <GroupSummary turns={turns} turnsPricing={turnsPricing} />
      </div>

      <div className="p-4">
        {/* User message (left-aligned) */}
        {userText && (
          <div className="mb-4 flex flex-col items-start">
            <div className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <svg className="h-4 w-4" viewBox="0 0 256 256" fill="currentColor">
                <path d="M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c19.87-34.56,51.68-56,87.07-56s67.2,21.44,87.07,56a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z" />
              </svg>
              <span className="font-semibold text-foreground">You</span>
              <span>{formatTimestamp(firstTurn.timestamp)}</span>
            </div>
            <div className={cn(
              "max-w-[70%] rounded-2xl rounded-tl-md border px-4 py-2.5 font-mono text-[15px] max-sm:max-w-full",
              userText.startsWith("/") ? "border-primary/30 bg-primary/15 text-primary-foreground" : "border-primary/20 bg-primary/10 text-foreground",
            )}>
              <p className="whitespace-pre-wrap break-words">{userText}</p>
            </div>
          </div>
        )}

        {/* Level 2: Agent response block (right-aligned, max-width) */}
        <div className="flex flex-col items-end">
          <div className="max-w-[80%] lg:max-w-[50%] rounded-lg border border-border/50 bg-muted/30 p-3">
            {/* Header (right-aligned) */}
            <div className="mb-2 flex items-center justify-end gap-2 text-sm text-muted-foreground">
              <span className="rounded bg-accent px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
                T{firstGlobalIdx + 1}–{firstGlobalIdx + turns.length}
              </span>
              <span className="font-semibold text-foreground">Claude</span>
              <svg className="h-4 w-4" viewBox="0 0 256 256" fill="currentColor">
                <path d="M198,112a6,6,0,0,1-6,6H168a14,14,0,0,1-14-14V80a6,6,0,0,1,12,0v24a2,2,0,0,0,2,2h24A6,6,0,0,1,198,112ZM128,26a94,94,0,1,0,94,94A94.11,94.11,0,0,0,128,26Zm82,94a82,82,0,1,1-82-82A82.09,82.09,0,0,1,210,120ZM176,160a6,6,0,0,1-6,6H146a14,14,0,0,1-14-14V128a6,6,0,0,1,12,0v24a2,2,0,0,0,2,2h24A6,6,0,0,1,176,160Zm-56,0a6,6,0,0,1-6,6H90a14,14,0,0,1-14-14V128a6,6,0,0,1,12,0v24a2,2,0,0,0,2,2h24A6,6,0,0,1,120,160Z" />
              </svg>
            </div>

            {/* Processing turns (T1–T{n-1}) — collapsed by default */}
            {lastTextIdx > 0 && (
              <ProcessingTurns
                turns={turns.slice(0, lastTextIdx)}
                turnsPricing={turnsPricing}
                firstGlobalIdx={firstGlobalIdx}
              />
            )}

            {/* Final turn (T{n}) — visible by default */}
            {lastTextIdx >= 0 && (
              <div className={lastTextIdx > 0 ? "mt-2" : ""}>
                <TurnRow
                  turn={turns[lastTextIdx]}
                  index={firstGlobalIdx + lastTextIdx}
                  pricing={turnsPricing[firstGlobalIdx + lastTextIdx]}
                  isFinalOutput={true}
                />
              </div>
            )}

            {/* Agent output bubble */}
            {lastTextIdx >= 0 && (
              <div className="mt-3">
                <AgentOutputBubble text={getAssistantText(turns[lastTextIdx])!} turn={turns[lastTextIdx]} />
              </div>
            )}
          </div>
        </div>
      </div>
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
  // A new group starts when a turn has user text (and it's not the very first turn).
  const groups: { turns: Turn[]; startIndex: number }[] = []
  let current: Turn[] = []
  let currentStart = 0

  for (let i = 0; i < turns.length; i++) {
    if (hasUserText(turns[i]) && current.length > 0) {
      groups.push({ turns: current, startIndex: currentStart })
      current = []
      currentStart = i
    }
    current.push(turns[i])
  }
  if (current.length > 0) groups.push({ turns: current, startIndex: currentStart })

  return (
    <div className={cn("space-y-6", className)}>
      {groups.map((group) => (
        <InteractionGroup
          key={group.turns[0].timestamp}
          turns={group.turns}
          turnsPricing={turnsPricing}
        />
      ))}
    </div>
  )
}
