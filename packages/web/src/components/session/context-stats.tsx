import { useState } from "react"
import type { ContextStats as ContextStatsType, ContextCategory } from "claude-timeline-types"
import { cn, formatTokens, formatTimestamp } from "@/lib/utils"

interface ContextStatsProps {
  stats: ContextStatsType
  className?: string
}

const CATEGORY_LABELS: Record<ContextCategory, string> = {
  "user-message": "User Messages",
  "tool-output": "Tool Output",
  "thinking-text": "Thinking",
  system: "System",
  compact: "Compacted",
  other: "Other",
}

const CATEGORY_COLORS: Record<ContextCategory, string> = {
  "user-message": "bg-blue-500",
  "tool-output": "bg-violet-500",
  "thinking-text": "bg-amber-500",
  system: "bg-slate-400",
  compact: "bg-accent",
  other: "bg-muted-foreground",
}

function CategoryBar({
  category,
  tokens,
  total,
}: {
  category: ContextCategory
  tokens: number
  total: number
}) {
  if (tokens === 0) return null
  const pct = total > 0 ? (tokens / total) * 100 : 0

  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">
        {CATEGORY_LABELS[category]}
      </span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-accent">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", CATEGORY_COLORS[category])}
          style={{ width: `${pct.toFixed(1)}%` }}
        />
      </div>
      <span className="w-16 shrink-0 text-right text-xs font-medium text-muted-foreground">
        {formatTokens(tokens)}
      </span>
      <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}

function InjectionTimeline({ stats }: { stats: ContextStatsType }) {
  const maxTokens = Math.max(...stats.injections.map((inj) => inj.inputTokens), 1)
  const totalInjections = stats.injections.length
  // Sample at most 200 points for performance
  const step = Math.max(1, Math.floor(totalInjections / 200))
  const sampled = stats.injections.filter((_, i) => i % step === 0 || i === totalInjections - 1)

  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Injection Timeline
      </h4>
      <div className="relative h-24 overflow-hidden rounded-lg bg-muted">
        <div className="absolute inset-0 flex items-end">
          {sampled.map((inj) => {
            const heightPct = (inj.inputTokens / maxTokens) * 100
            return (
              <div
                key={inj.recordIndex}
                className={cn(
                  "flex-1 transition-colors hover:opacity-80",
                  CATEGORY_COLORS[inj.category],
                )}
                style={{ height: `${Math.max(heightPct, 1)}%` }}
                title={`${CATEGORY_LABELS[inj.category]}: ${formatTokens(inj.inputTokens)} tokens${inj.timestamp ? ` at ${formatTimestamp(inj.timestamp)}` : ""}`}
              />
            )
          })}
        </div>
        {/* Phase dividers */}
        {stats.phases.slice(1).map((phase) => {
          const position = (phase.startRecordIndex / totalInjections) * 100
          return (
            <div
              key={phase.phaseNumber}
              className="absolute top-0 bottom-0 w-px bg-muted-foreground/30"
              style={{ left: `${position}%` }}
              title={`Phase ${phase.phaseNumber} starts here`}
            />
          )
        })}
      </div>
      <div className="mt-1 flex justify-between text-[0.625rem] text-muted-foreground">
        <span>Start</span>
        <span>{totalInjections} injections across {stats.phaseCount} phase{stats.phaseCount !== 1 ? "s" : ""}</span>
        <span>End</span>
      </div>
    </div>
  )
}

function PhaseList({ stats }: { stats: ContextStatsType }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Phases
      </h4>
      <div className="flex flex-wrap gap-2">
        {stats.phases.map((phase) => {
          const phaseInjections = stats.injections.filter(
            (inj) => inj.phaseNumber === phase.phaseNumber,
          )
          const phaseTokens = phaseInjections.reduce((sum, inj) => sum + inj.inputTokens, 0)
          return (
            <div
              key={phase.phaseNumber}
              className="rounded-lg bg-muted px-3 py-2 text-xs"
            >
              <span className="font-medium text-muted-foreground">
                Phase {phase.phaseNumber}
              </span>
              <span className="ml-2 text-muted-foreground">
                {formatTokens(phaseTokens)} input · {phaseInjections.length} records
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ContextStats({ stats, className }: ContextStatsProps) {
  const [expanded, setExpanded] = useState(false)

  const categories = (Object.entries(stats.tokensByCategory) as [ContextCategory, number][])
    .sort(([, a], [, b]) => b - a)

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card",
        className,
      )}
    >
      {/* Header — always visible, acts as toggle */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Context Stats
          </h3>
          <span className="text-xs text-muted-foreground">
            {formatTokens(stats.totalInputTokens)} input tokens · {stats.phaseCount} phase{stats.phaseCount !== 1 ? "s" : ""}
          </span>
        </div>
        <svg
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="space-y-4 border-t border-border px-4 pb-4 pt-3">
          {/* Tokens by category */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tokens by Category
            </h4>
            <div className="space-y-1.5">
              {categories.map(([category, tokens]) => (
                <CategoryBar
                  key={category}
                  category={category}
                  tokens={tokens}
                  total={stats.totalInputTokens}
                />
              ))}
            </div>
          </div>

          {/* Phase list */}
          <PhaseList stats={stats} />

          {/* Injection timeline */}
          <InjectionTimeline stats={stats} />
        </div>
      )}
    </div>
  )
}
