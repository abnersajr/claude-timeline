import { useState, useRef, useEffect, useCallback } from "react"
import type { Turn, TurnPricing } from "@claude-timeline/types"
import { cn, formatTokens, formatCost } from "@/lib/utils"
import { buildSessionSteps } from "@/lib/steps"
import type { StepAggregate } from "@/lib/steps"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenChartProps {
  turns: Turn[]
  turnsPricing: TurnPricing[]
  className?: string
}

type TokenKey =
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"

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
  { key: "cacheWriteTokens", label: "Cache Write", color: "bg-violet-500" },
]

const BAR_WIDTH = 20
const MAX_BAR_HEIGHT = 340
const MIN_BAR_HEIGHT = 4
const BAR_GAP = 4
const LABEL_HEIGHT = 20

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function segmentTotal(usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }, key: TokenKey): number {
  return usage[key] ?? 0
}

function buildStepAggregates(turns: Turn[], turnsPricing: TurnPricing[]): StepAggregate[] {
  return buildSessionSteps(turns, turnsPricing).stepAggregates
}

/** Compute unique cache write types present across all turns */
function computeCacheWriteTypes(turns: Turn[]): Set<string> {
  const writeTypes = new Set<string>()
  for (const turn of turns) {
    if (turn.cacheWriteType && turn.cacheWriteType !== "none") {
      writeTypes.add(turn.cacheWriteType)
    }
  }
  return writeTypes
}

function CacheWriteTypeBadge({ types }: { types: Set<string> }) {
  if (types.size === 0) return null
  const label = Array.from(types).join(", ")
  return (
    <span className="ml-1 inline-flex items-center rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[0.5rem] font-medium text-violet-400">
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Legend({ cacheWriteTypes }: { cacheWriteTypes: Set<string> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {SEGMENTS.map((seg) => (
        <div key={seg.key} className="flex items-center gap-1.5 text-xs">
          <span className={cn("inline-block h-2.5 w-2.5 rounded-sm", seg.color)} />
          <span className="text-muted-foreground">{seg.label}</span>
          {seg.key === "cacheWriteTokens" && <CacheWriteTypeBadge types={cacheWriteTypes} />}
        </div>
      ))}
    </div>
  )
}

function StepBar({
  step,
  maxTokens,
  cumulativeCost: _cumulativeCost,
  cacheWriteTypes,
}: {
  step: StepAggregate
  maxTokens: number
  cumulativeCost: number
  cacheWriteTypes: Set<string>
}) {
  const [hovered, setHovered] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)

  if (maxTokens === 0) return null

  const barHeight = Math.max((step.totalTokens / maxTokens) * MAX_BAR_HEIGHT, MIN_BAR_HEIGHT)

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
      minWidth: "220px",
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
          const val = segmentTotal(step, seg.key)
          if (val === 0) return null
          const segHeight = step.totalTokens > 0 ? (val / step.totalTokens) * barHeight : 0
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
            Step {step.stepIndex + 1}
          </p>
          <div className="space-y-0.5">
            {SEGMENTS.map((seg) => {
              const val = segmentTotal(step, seg.key)
              if (val === 0) return null
              return (
                <div key={seg.key} className="flex items-center justify-between gap-4 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className={cn("inline-block h-2 w-2 rounded-sm", seg.color)} />
                    <span className="text-muted-foreground">{seg.label}</span>
                    {seg.key === "cacheWriteTokens" && <CacheWriteTypeBadge types={cacheWriteTypes} />}
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
                {formatTokens(step.totalTokens)}
              </span>
            </div>
            {/* Step cost */}
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Step cost</span>
              <span className="font-semibold text-emerald-500">
                {formatCost(step.totalCost)}
              </span>
            </div>
            {/* Cumulative cost */}
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Cumulative</span>
              <span className="font-semibold text-emerald-500">
                +{formatCost(step.cumulativeCost)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Label — every 5th step, below the bar */}
      <span
        className={cn(
          "text-[0.625rem] mt-1 whitespace-nowrap text-center w-full",
          (step.stepIndex + 1) % 5 === 0 ? "text-muted-foreground" : "text-transparent",
        )}
      >
        {step.stepIndex + 1}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TokenChart({ turns, turnsPricing, className }: TokenChartProps) {
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

  // Build step aggregates
  const stepAggregates = buildStepAggregates(turns, turnsPricing)
  const nonZeroSteps = stepAggregates.filter((s) => s.totalTokens > 0)
  const cacheWriteTypes = computeCacheWriteTypes(turns)

  if (nonZeroSteps.length === 0) {
    return (
      <div className={cn("rounded-xl border border-border bg-background p-6 overflow-visible", className)}>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Token Usage
        </h3>
        <p className="mt-4 text-sm text-muted-foreground">No steps to display.</p>
      </div>
    )
  }

  // Compute max total for scaling
  const maxTokens = nonZeroSteps.reduce((max, step) => {
    return Math.max(max, step.totalTokens)
  }, 0)

  // Limit display to 50 bars max for readability; sample evenly
  const maxBars = 50
  const displaySteps =
    nonZeroSteps.length <= maxBars
      ? nonZeroSteps
      : nonZeroSteps.filter((_, i) => i % Math.ceil(nonZeroSteps.length / maxBars) === 0 || i === nonZeroSteps.length - 1)

  return (
    <div className={cn("rounded-xl border border-border bg-background p-6 overflow-visible", className)}>
      {/* Header */}
      <div className="mb-4 px-1">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Token Usage
          </h3>
          <span className="text-xs text-muted-foreground">
            {nonZeroSteps.length} step{nonZeroSteps.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="mt-2">
          <Legend cacheWriteTypes={cacheWriteTypes} />
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
            {displaySteps.map((step) => (
              <StepBar
                key={step.stepIndex}
                step={step}
                maxTokens={maxTokens}
                cumulativeCost={step.cumulativeCost}
                cacheWriteTypes={cacheWriteTypes}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Summary row */}
      <div className="mt-4 grid grid-cols-5 gap-2 rounded-lg border border-border/50 p-3">
        {SEGMENTS.map((seg) => {
          const total = nonZeroSteps.reduce(
            (sum, step) => sum + segmentTotal(step, seg.key),
            0,
          )
          return (
            <div key={seg.key} className="text-center">
              <p className="text-[0.625rem] text-muted-foreground flex items-center justify-center gap-1">
                {seg.label}
                {seg.key === "cacheWriteTokens" && <CacheWriteTypeBadge types={cacheWriteTypes} />}
              </p>
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
