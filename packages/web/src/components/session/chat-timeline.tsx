"use client"

import { useState } from "react"
import Markdown from "react-markdown"
import type {
  ConversationGroup,
  Message,
  Turn,
  TurnPricing,
  Subagent,
} from "claude-timeline-types"
import {
  cn,
  formatTimestamp,
  formatCost,
  formatTokens,
} from "@/lib/utils"
import { ToolCallList, ToolCallPills } from "./tool-call"
import { CollapsibleResult } from "./collapsible-result"
import { SubagentTimelineStep } from "./subagent-timeline-step"
import {
  type Step,
  buildSessionSteps,
  classifyStepTurn,
  computeGroupStepOffsets,
  getStepToolName,
} from "@/lib/steps"

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
  if (cmdMatch) return cmdMatch[1]!.trim()
  const msgMatch = raw.match(/<command-message>([\s\S]*?)<\/command-message>/)
  if (msgMatch) return msgMatch[1]!.trim()
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
function GroupSummary({ turns, turnsPricing, subagents }: { turns: Turn[]; turnsPricing: TurnPricing[]; subagents?: Subagent[] }) {
  let ctx = 0, out = 0, cost = 0, tools = 0
  for (let i = 0; i < turns.length; i++) {
    ctx += totalContext(turns[i]!)
    out += turns[i]!.tokenUsage.outputTokens
    tools += turns[i]!.toolCalls.length
    if (turnsPricing[i]) cost += turnsPricing[i]!.totalCost
  }

  // Subagent totals
  const subagentCount = subagents?.length ?? 0
  const subagentCost = subagents?.reduce((sum, s) => sum + (s.totalCost ?? 0), 0) ?? 0

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
      {subagentCount > 0 && (
        <>
          <span className="text-border/40">·</span>
          <span className="text-violet-400">
            {subagentCount} subagent{subagentCount !== 1 ? "s" : ""}
            {subagentCost > 0 && ` (${formatCost(subagentCost)})`}
          </span>
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
          toolUseId: String(block.toolUseId ?? ""),
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
        <div className="mt-1 ml-6 text-sm text-foreground/70 break-words blur-sensitive">
          <span className="inline-block rounded bg-muted px-1 py-0.5 text-[10px] font-semibold text-muted-foreground mr-1.5 align-middle">text</span>
          <span className="align-middle">{text}</span>
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

          {/* Message tool_result blocks — collapsible */}
          {messageToolResults.length > 0 && (
            <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-2">
              {messageToolResults.map((tr, i) => (
                <CollapsibleResult
                  key={i}
                  label={`Result (${messageToolResults.length})`}
                  content={tr.content}
                  isError={tr.isError}
                  labelClassName="text-blue-400 hover:text-blue-300"
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Step row — renders one billing step (anchor + tool turns) as a collapsed row */
function StepRow({
  step,
  index,
  globalOffset,
}: {
  step: Step
  index: number
  globalOffset: number
}) {
  const [expanded, setExpanded] = useState(false)
  const anchorName = getStepToolName(step.anchor)
  const anchorHasContent = getAssistantText(step.anchor) !== null

  // Summary text
  let summary: string
  if (step.tools.length === 0) {
    if (anchorName) {
      summary = anchorHasContent ? `${anchorName} → result` : anchorName
    } else if (anchorHasContent) {
      const text = getAssistantText(step.anchor)!
      summary = text.length > 60 ? text.slice(0, 60) + "…" : text
    } else {
      summary = "processing…"
    }
  } else if (!anchorName) {
    // PROCESSING anchor (no tool)
    const unique = [...new Set(step.toolNames)]
    const prefix = anchorHasContent
      ? getAssistantText(step.anchor)!.slice(0, 40)
      : "processing…"
    summary = step.tools.length === 1
      ? `${prefix} → ${step.toolNames[0]}`
      : `${prefix} → [${unique.join(", ")}] ×${step.tools.length}`
  } else {
    // TOOL_CALL anchor
    const unique = [...new Set(step.toolNames)]
    summary = `${anchorName} → [${unique.join(", ")}]`
  }

  const uniqueToolNames = [...new Set(step.toolNames)]
  const ctx = totalContext(step.anchor)

  return (
    <div id={`step-S${index + 1}`} className="py-1.5 px-2 rounded hover:bg-muted/20 transition-colors">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {/* Step badge */}
        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-bold text-primary">
          S{index + 1}
        </span>

        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="cursor-pointer shrink-0 flex items-center gap-1.5"
        >
          <svg
            className={cn("h-3 w-3 shrink-0 transition-transform text-muted-foreground", expanded && "rotate-90")}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          <span className="text-foreground/80">{summary}</span>
        </button>

        {/* Tool pills (only when multiple unique tools) */}
        {uniqueToolNames.length > 1 && (
          <div className="flex items-center gap-1 shrink-0">
            {uniqueToolNames.map((name) => (
              <span
                key={name}
                className="rounded-md border border-orange-500/20 bg-orange-500/10 px-1.5 py-0.5 text-xs font-medium text-orange-400"
              >
                {name}
              </span>
            ))}
          </div>
        )}

        {/* Metrics */}
        <span className="shrink-0 font-mono text-xs text-muted-foreground ml-auto">{formatTokens(ctx)} ctx</span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatTokens(step.totalOutput)} out</span>
        {step.totalCost > 0 && (
          <span className="shrink-0 font-mono text-xs text-emerald-500">{formatCost(step.totalCost)}</span>
        )}
        {step.tools.length > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground">
            ×{step.tools.length} tool{step.tools.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Expanded: raw turn rows */}
      {expanded && (
        <div className="mt-1.5 ml-5 pl-3 border-l-2 border-border/30 space-y-0.5">
          {[step.anchor, ...step.tools].map((turn, i) => (
            <TurnRow
              key={turn.timestamp}
              turn={turn}
              index={globalOffset + i}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Agent output bubble — the text the user actually sees */
function AgentOutputBubble({ text, turn: _turn }: { text: string; turn: Turn }) {
  return (
    <div className="flex flex-col items-end">
      <div className="relative">
        <div className="absolute -top-1.5 right-3 h-3 w-3 rotate-45 border-r border-t border-emerald-500/30 bg-emerald-500/5" />
        <div className="relative max-w-full rounded-2xl rounded-tr-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 blur-sensitive max-sm:max-w-full">
          <div className="prose prose-sm prose-invert max-w-none font-mono text-[0.9375rem] text-foreground/90 break-words [&_strong]:text-foreground [&_code]:text-emerald-400 [&_code]:bg-emerald-500/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:bg-muted/50 [&_pre]:p-2 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_ul]:my-1 [&_li]:my-0.5">
            <Markdown>{text}</Markdown>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Processing turns (T1–T{n-1}) — grouped into billing-based steps */
function ProcessingTurns({
  turns,
  turnsPricing,
  firstGlobalIdx,
  stepOffset,
  subagents,
}: {
  turns: Turn[]
  turnsPricing: TurnPricing[]
  firstGlobalIdx: number
  stepOffset: number
  subagents?: Subagent[]
}) {
  const { steps } = buildSessionSteps(turns, turnsPricing)

  // Build a map from turn index → subagents spawned at that turn
  const subagentsByTurn = new Map<number, Subagent[]>()
  if (subagents) {
    for (const sub of subagents) {
      if (sub.parentTurnIndex !== undefined) {
        let arr = subagentsByTurn.get(sub.parentTurnIndex)
        if (!arr) {
          arr = []
          subagentsByTurn.set(sub.parentTurnIndex, arr)
        }
        arr.push(sub)
      }
    }
  }

  // Running offset for global turn index inside each step
  let offset = 0
  let currentStepIdx = 0

  return (
    <div className="space-y-0.5">
      {steps.map((step, i) => {
        // Skip user-message steps — already rendered as chat bubbles
        if (classifyStepTurn(step.anchor) === "user") {
          // Still advance the offset for correct global turn numbering
          offset += 1 + step.tools.length
          return null
        }
        const globalOffset = firstGlobalIdx + offset
        const stepSize = 1 + step.tools.length
        offset += stepSize
        currentStepIdx++

        // Check if any subagents were spawned at the anchor turn's global index
        const anchorGlobalIdx = globalOffset
        const stepSubagents = subagentsByTurn.get(anchorGlobalIdx)

        return (
          <div key={step.anchor.timestamp}>
            <StepRow
              step={step}
              index={stepOffset + i}
              globalOffset={globalOffset}
            />
            {/* Inline subagent cards with connector lines */}
            {stepSubagents && stepSubagents.length > 0 && (
              <SubagentTimelineStep
                subagents={stepSubagents}
                stepIndex={stepOffset + i}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Interaction group container */
function InteractionGroup({
  turns,
  turnsPricing,
  startIndex,
  stepOffset,
  subagents,
}: {
  turns: Turn[]
  turnsPricing: TurnPricing[]
  startIndex: number
  stepOffset: number
  subagents?: Subagent[]
}) {
  // Extract user message from the first turn
  const firstTurn = turns[0]
  const userText = getUserText(firstTurn!)

  // Find the last turn with assistant text (the "output" to the user)
  let lastTextIdx = -1
  for (let i = turns.length - 1; i >= 0; i--) {
    if (getAssistantText(turns[i]!)) {
      lastTextIdx = i
      break
    }
  }

  // Compute global indices
  const firstGlobalIdx = startIndex

  return (
    <div className="rounded-lg border border-border/60 bg-card shadow-sm">
      {/* Group summary at top */}
      <div className="border-b border-border/40">
        <GroupSummary turns={turns} turnsPricing={turnsPricing} subagents={subagents} />
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
              <span>{formatTimestamp(firstTurn!.timestamp)}</span>
            </div>
            <div className={cn(
              "max-w-[70%] rounded-2xl rounded-tl-md border px-4 py-2.5 font-mono text-[0.9375rem] blur-sensitive max-sm:max-w-full",
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

            {/* All turns grouped into billing-based steps (including final output) */}
            <ProcessingTurns
              turns={turns}
              turnsPricing={turnsPricing}
              firstGlobalIdx={firstGlobalIdx}
              stepOffset={stepOffset}
              subagents={subagents}
            />

            {/* Agent output bubble (rendered after the last step) */}
            {lastTextIdx >= 0 && getAssistantText(turns[lastTextIdx]!) && (
              <div className="mt-3">
                <AgentOutputBubble text={getAssistantText(turns[lastTextIdx]!)!} turn={turns[lastTextIdx]!} />
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
  conversationGroups: _conversationGroups,
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
    if (hasUserText(turns[i]!) && current.length > 0) {
      groups.push({ turns: current, startIndex: currentStart })
      current = []
      currentStart = i
    }
    current.push(turns[i]!)
  }
  if (current.length > 0) groups.push({ turns: current, startIndex: currentStart })

  const groupStepOffsets = computeGroupStepOffsets(groups, turnsPricing)

  return (
    <div className={cn("space-y-6", className)}>
      {groups.map((group, groupIdx) => (
        <InteractionGroup
          key={group.turns[0]!.timestamp}
          turns={group.turns}
          turnsPricing={turnsPricing.slice(group.startIndex, group.startIndex + group.turns.length)}
          startIndex={group.startIndex}
          stepOffset={groupStepOffsets[groupIdx]!}
          subagents={subagents}
        />
      ))}
    </div>
  )
}
