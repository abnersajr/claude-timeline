import { useState } from "react"
import type { Turn, TokenUsage } from "@timeline/types"
import { cn, formatTokens } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenChartProps {
  turns: Turn[]
  className?: string
}

type TokenKey =
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheCreation5mTokens"
  | "cacheCreation1hTokens"
  | "cacheCreationTokens"

interface TokenSegment {
  key: TokenKey
  label: string
  color: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEGMENTS: TokenSegment[] = [
  { key: "inputTokens", label: "Input", color: "bg-accent-blue" },
  { key: "outputTokens", label: "Output", color: "bg-accent-green" },
  { key: "cacheReadTokens", label: "Cache Read", color: "bg-accent-amber" },
  {
    key: "cacheCreation5mTokens",
    label: "Cache Write (5m)",
    color: "bg-accent-purple",
  },
  {
    key: "cacheCreation1hTokens",
    label: "Cache Write (1h)",
    color: "bg-accent-pink",
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function segmentTotal(usage: TokenUsage, key: TokenKey): number {
  return usage[key] ?? 0
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {SEGMENTS.map((seg) => (
        <div key={seg.key} className="flex items-center gap-1.5 text-xs">
          <span className={cn("inline-block h-2.5 w-2.5 rounded-sm", seg.color)} />
          <span className="text-text-muted">{seg.label}</span>
        </div>
      ))}
    </div>
  )
}

function TurnBar({
  turn,
  index,
  maxTokens,
}: {
  turn: Turn
  index: number
  maxTokens: number
}) {
  const [hovered, setHovered] = useState(false)
  const total =
    turn.tokenUsage.inputTokens +
    turn.tokenUsage.outputTokens +
    turn.tokenUsage.cacheReadTokens +
    (turn.tokenUsage.cacheCreation5mTokens ?? 0) +
    (turn.tokenUsage.cacheCreation1hTokens ?? 0)

  if (maxTokens === 0) return null

  const heightPct = Math.max((total / maxTokens) * 100, 2)

  return (
    <div className="group flex flex-col items-center gap-1">
      {/* Tooltip */}
      {hovered && (
        <div className="absolute z-10 -translate-y-full rounded-lg border border-border bg-surface-1 p-3 shadow-lg">
          <p className="mb-1.5 text-xs font-semibold text-text-primary">
            Turn {index + 1}
          </p>
          <div className="space-y-0.5">
            {SEGMENTS.map((seg) => {
              const val = segmentTotal(turn.tokenUsage, seg.key)
              if (val === 0) return null
              return (
                <div key={seg.key} className="flex items-center justify-between gap-4 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className={cn("inline-block h-2 w-2 rounded-sm", seg.color)} />
                    <span className="text-text-muted">{seg.label}</span>
                  </span>
                  <span className="font-medium text-text-secondary">
                    {formatTokens(val)}
                  </span>
                </div>
              )
            })}
            <div className="mt-1 border-t border-border pt-1 flex justify-between text-xs">
              <span className="text-text-muted">Total</span>
              <span className="font-semibold text-text-primary">
                {formatTokens(total)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Bar */}
      <div
        className="relative flex w-full flex-col-reverse cursor-pointer"
        style={{ height: "120px" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {SEGMENTS.map((seg) => {
          const val = segmentTotal(turn.tokenUsage, seg.key)
          if (val === 0) return null
          const segPct = total > 0 ? (val / total) * heightPct : 0
          return (
            <div
              key={seg.key}
              className={cn(
                "w-full transition-opacity group-hover:opacity-80",
                seg.color,
              )}
              style={{ height: `${Math.max(segPct, 0.5)}%` }}
            />
          )
        })}
      </div>

      {/* Label */}
      <span className="text-[10px] text-text-muted">{index + 1}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TokenChart({ turns, className }: TokenChartProps) {
  if (turns.length === 0) {
    return (
      <div className={cn("rounded-xl border border-border bg-surface-1 p-6", className)}>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
          Token Usage
        </h3>
        <p className="mt-4 text-sm text-text-muted">No turns to display.</p>
      </div>
    )
  }

  // Compute max total for scaling
  const maxTokens = turns.reduce((max, turn) => {
    const total =
      turn.tokenUsage.inputTokens +
      turn.tokenUsage.outputTokens +
      turn.tokenUsage.cacheReadTokens +
      (turn.tokenUsage.cacheCreation5mTokens ?? 0) +
      (turn.tokenUsage.cacheCreation1hTokens ?? 0)
    return Math.max(max, total)
  }, 0)

  // Limit display to 50 bars max for readability; sample evenly
  const maxBars = 50
  const displayTurns =
    turns.length <= maxBars
      ? turns
      : turns.filter((_, i) => i % Math.ceil(turns.length / maxBars) === 0 || i === turns.length - 1)

  return (
    <div className={cn("rounded-xl border border-border bg-surface-1 p-6", className)}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
          Token Usage
        </h3>
        <span className="text-xs text-text-muted">
          {turns.length} turn{turns.length !== 1 ? "s" : ""}
        </span>
      </div>

      <Legend />

      {/* Chart area */}
      <div className="relative mt-4">
        <div className="flex items-end gap-px" style={{ height: "140px" }}>
          {displayTurns.map((turn, i) => {
            const originalIndex =
              turns.length <= maxBars
                ? i
                : turns.indexOf(turn)
            return (
              <TurnBar
                key={turn.timestamp}
                turn={turn}
                index={originalIndex}
                maxTokens={maxTokens}
              />
            )
          })}
        </div>
      </div>

      {/* Summary row */}
      <div className="mt-4 grid grid-cols-5 gap-2">
        {SEGMENTS.map((seg) => {
          const total = turns.reduce(
            (sum, t) => sum + segmentTotal(t.tokenUsage, seg.key),
            0,
          )
          return (
            <div key={seg.key} className="rounded-lg bg-surface-2 p-2 text-center">
              <p className="text-[10px] text-text-muted">{seg.label}</p>
              <p className="text-xs font-semibold text-text-secondary">
                {formatTokens(total)}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
