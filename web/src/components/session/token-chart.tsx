import { useState, useRef, useEffect, useCallback } from "react"
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
  { key: "inputTokens", label: "Input", color: "bg-blue-500" },
  { key: "outputTokens", label: "Output", color: "bg-emerald-500" },
  { key: "cacheReadTokens", label: "Cache Read", color: "bg-amber-500" },
  { key: "cacheCreation5mTokens", label: "Cache Write (5m)", color: "bg-violet-500" },
  { key: "cacheCreation1hTokens", label: "Cache Write (1h)", color: "bg-pink-500" },
]

const BAR_WIDTH = 20
const MAX_BAR_HEIGHT = 340
const MIN_BAR_HEIGHT = 4
const BAR_GAP = 4
const LABEL_HEIGHT = 20

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function segmentTotal(usage: TokenUsage, key: TokenKey): number {
  return usage[key] ?? 0
}

function turnTotal(turn: Turn): number {
  return (
    turn.tokenUsage.inputTokens +
    turn.tokenUsage.outputTokens +
    turn.tokenUsage.cacheReadTokens +
    (turn.tokenUsage.cacheCreation5mTokens ?? 0) +
    (turn.tokenUsage.cacheCreation1hTokens ?? 0)
  )
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
          <span className="text-muted-foreground">{seg.label}</span>
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
  const barRef = useRef<HTMLDivElement>(null)
  const total = turnTotal(turn)

  if (maxTokens === 0) return null

  const barHeight = Math.max((total / maxTokens) * MAX_BAR_HEIGHT, MIN_BAR_HEIGHT)

  // Calculate fixed position for tooltip when hovered
  const getTooltipStyle = (): React.CSSProperties => {
    if (!barRef.current) return {}
    const rect = barRef.current.getBoundingClientRect()
    return {
      position: "fixed" as const,
      left: `${rect.left + rect.width / 2}px`,
      top: `${rect.top - 8}px`,
      transform: "translate(-50%, -100%)",
      zIndex: 9999,
      minWidth: "180px",
    }
  }

  return (
    <div
      className="group relative flex flex-col items-center"
      style={{ width: `${BAR_WIDTH + BAR_GAP}px` }}
    >
      {/* Bar — fixed 20px wide, grows upward from bottom */}
      <div
        ref={barRef}
        className="relative flex flex-col-reverse cursor-pointer rounded-sm overflow-hidden"
        style={{ width: `${BAR_WIDTH}px`, height: `${barHeight}px` }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {SEGMENTS.map((seg) => {
          const val = segmentTotal(turn.tokenUsage, seg.key)
          if (val === 0) return null
          const segHeight = total > 0 ? (val / total) * barHeight : 0
          return (
            <div
              key={seg.key}
              className={cn(
                "w-full transition-opacity group-hover:opacity-80",
                seg.color,
              )}
              style={{ height: `${Math.max(segHeight, 0.5)}px` }}
            />
          )
        })}
      </div>

      {/* Tooltip — fixed positioning to escape ALL overflow containers */}
      {hovered && (
        <div
          style={getTooltipStyle()}
          className="pointer-events-none rounded-lg border border-border bg-card p-3 shadow-lg"
        >
          <p className="mb-1.5 text-xs font-semibold text-foreground">
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
                    <span className="text-muted-foreground">{seg.label}</span>
                  </span>
                  <span className="font-medium text-muted-foreground">
                    {formatTokens(val)}
                  </span>
                </div>
              )
            })}
            <div className="mt-1 border-t border-border pt-1 flex justify-between text-xs">
              <span className="text-muted-foreground">Total</span>
              <span className="font-semibold text-foreground">
                {formatTokens(total)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Label — every 5th turn, below the bar */}
      <span
        className={cn(
          "text-[10px] mt-1 whitespace-nowrap",
          (index + 1) % 5 === 0 ? "text-muted-foreground" : "text-transparent",
        )}
      >
        {index + 1}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TokenChart({ turns, className }: TokenChartProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current
    if (el) {
      setOverflowing(el.scrollWidth > el.clientWidth)
    }
  }, [])

  useEffect(() => {
    checkOverflow()
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(checkOverflow)
    ro.observe(el)
    return () => ro.disconnect()
  }, [checkOverflow, turns])

  if (turns.length === 0) {
    return (
      <div className={cn("rounded-xl border border-border bg-background p-6 overflow-visible", className)}>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Token Usage
        </h3>
        <p className="mt-4 text-sm text-muted-foreground">No turns to display.</p>
      </div>
    )
  }

  // Compute max total for scaling
  const maxTokens = turns.reduce((max, turn) => {
    return Math.max(max, turnTotal(turn))
  }, 0)

  // Limit display to 50 bars max for readability; sample evenly
  const maxBars = 50
  const displayTurns =
    turns.length <= maxBars
      ? turns
      : turns.filter((_, i) => i % Math.ceil(turns.length / maxBars) === 0 || i === turns.length - 1)

  return (
    <div className={cn("rounded-xl border border-border bg-background p-6 overflow-visible", className)}>
      {/* Header */}
      <div className="mb-4 px-1">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Token Usage
          </h3>
          <span className="text-xs text-muted-foreground">
            {turns.length} turn{turns.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="mt-2">
          <Legend />
        </div>
      </div>

      {/* Chart area — tooltip must be OUTSIDE overflow container to avoid clipping */}
      <div className="relative mt-4">
        <div
          ref={scrollRef}
          className="overflow-x-auto"
          style={
            overflowing
              ? {
                  maskImage:
                    "linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)",
                  WebkitMaskImage:
                    "linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)",
                }
              : undefined
          }
        >
          <div
            className="flex items-end"
            style={{ gap: `${BAR_GAP}px`, minHeight: `${MAX_BAR_HEIGHT + LABEL_HEIGHT + 8}px` }}
          >
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
      </div>

      {/* Summary row */}
      <div className="mt-4 grid grid-cols-5 gap-2 rounded-lg border border-border/50 p-3">
        {SEGMENTS.map((seg) => {
          const total = turns.reduce(
            (sum, t) => sum + segmentTotal(t.tokenUsage, seg.key),
            0,
          )
          return (
            <div key={seg.key} className="text-center">
              <p className="text-[10px] text-muted-foreground">{seg.label}</p>
              <p className="text-xs font-semibold text-foreground">
                {formatTokens(total)}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
