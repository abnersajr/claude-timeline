"use client"

import { useState } from "react"
import { Collapsible } from "@base-ui/react/collapsible"
import type { ToolCall } from "@timeline/types"
import { cn } from "@/lib/utils"

interface ToolCallItemProps {
  toolCall: ToolCall
  className?: string
}

function truncateInput(input: Record<string, unknown>, maxLen = 80): string {
  const entries = Object.entries(input)
  if (entries.length === 0) return "{}"

  // Pick the most useful preview field
  const preview =
    (input.command as string) ??
    (input.pattern as string) ??
    (input.path as string) ??
    (input.description as string) ??
    (input.title as string) ??
    undefined

  if (preview && typeof preview === "string") {
    const truncated =
      preview.length > maxLen ? `${preview.slice(0, maxLen)}…` : preview
    return truncated
  }

  // Fallback: show key names
  const keys = entries.map(([k]) => k).slice(0, 3)
  const suffix = entries.length > 3 ? `, +${entries.length - 3}` : ""
  return `{${keys.join(", ")}${suffix}}`
}

function truncateResult(result: string, maxLen = 200): string {
  if (result.length <= maxLen) return result
  return `${result.slice(0, maxLen)}…`
}

/** Status indicator dot for tool call result */
function StatusDot({ isError }: { isError?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full flex-shrink-0",
        isError ? "bg-accent-red" : "bg-accent-green",
      )}
    />
  )
}

export function ToolCallItem({ toolCall, className }: ToolCallItemProps) {
  const [open, setOpen] = useState(false)
  const hasResult = toolCall.result != null && toolCall.result.length > 0
  const inputSummary = truncateInput(toolCall.input)

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className={className}>
      <Collapsible.Trigger
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left",
          "transition-colors hover:bg-surface-2",
          "cursor-pointer select-none",
          "group/tc",
        )}
      >
        {/* Expand chevron */}
        <svg
          className={cn(
            "h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform",
            open && "rotate-90",
          )}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.25 4.5l7.5 7.5-7.5 7.5"
          />
        </svg>

        {/* Tool name badge */}
        <span
          className={cn(
            "rounded bg-surface-3 px-1.5 py-0.5 text-xs font-medium text-text-secondary",
            toolCall.isTask &&
              "border border-accent-purple/30 bg-accent-purple/10 text-accent-purple",
          )}
        >
          {toolCall.name}
        </span>

        {/* Input summary */}
        <span className="flex-1 truncate font-mono text-xs text-text-muted">
          {inputSummary}
        </span>

        {/* Status + expand hint */}
        <div className="flex items-center gap-2">
          {hasResult && <StatusDot isError={toolCall.isError} />}
          <span className="text-[10px] text-text-muted opacity-0 transition-opacity group-hover/tc:opacity-100">
            {open ? "collapse" : "expand"}
          </span>
        </div>
      </Collapsible.Trigger>

      <Collapsible.Panel
        className={cn(
          "overflow-hidden",
          "data-[open]:animate-expand data-[closed]:animate-collapse",
        )}
      >
        <div className="space-y-2 px-3 pb-3 pt-1">
          {/* Full input */}
          <div>
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-text-muted">
              Input
            </span>
            <pre className="max-h-48 overflow-auto rounded-md bg-surface-3 p-2.5 font-mono text-xs text-text-secondary whitespace-pre-wrap break-all">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>

          {/* Result */}
          {hasResult && (
            <div>
              <span className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">
                Result
                {toolCall.isError && (
                  <span className="rounded bg-accent-red/15 px-1 py-0.5 text-accent-red">
                    error
                  </span>
                )}
              </span>
              <pre className="max-h-48 overflow-auto rounded-md bg-surface-3 p-2.5 font-mono text-xs text-text-secondary whitespace-pre-wrap break-all">
                {truncateResult(toolCall.result!)}
              </pre>
            </div>
          )}

          {/* Task metadata */}
          {toolCall.isTask && toolCall.taskDescription && (
            <div className="rounded-md border border-accent-purple/20 bg-accent-purple/5 p-2.5">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-accent-purple">
                Subagent Task
              </span>
              <p className="text-xs text-text-secondary">
                {toolCall.taskDescription}
              </p>
              {toolCall.taskSubagentType && (
                <span className="mt-1 inline-block rounded bg-accent-purple/15 px-1.5 py-0.5 text-[10px] text-accent-purple">
                  {toolCall.taskSubagentType}
                </span>
              )}
            </div>
          )}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

/** List of tool calls for a turn */
interface ToolCallListProps {
  toolCalls: ToolCall[]
  maxVisible?: number
  className?: string
}

export function ToolCallList({
  toolCalls,
  maxVisible = 10,
  className,
}: ToolCallListProps) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? toolCalls : toolCalls.slice(0, maxVisible)
  const hiddenCount = toolCalls.length - maxVisible

  if (toolCalls.length === 0) return null

  return (
    <div className={cn("space-y-0.5", className)}>
      <span className="mb-1 block px-3 text-[10px] font-medium uppercase tracking-wider text-text-muted">
        Tool Calls ({toolCalls.length})
      </span>
      {visible.map((tc) => (
        <ToolCallItem key={tc.toolUseId} toolCall={tc} />
      ))}
      {!showAll && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full py-1.5 text-center text-xs text-text-muted transition-colors hover:text-text-secondary"
        >
          Show {hiddenCount} more tool call{hiddenCount > 1 ? "s" : ""}
        </button>
      )}
    </div>
  )
}
