import type {
  Turn,
  TurnPricing,
  SessionPricing,
} from "@timeline/types"
import { cn, formatCost } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CostBreakdownProps {
  pricing: SessionPricing
  turns: Turn[]
  className?: string
}

interface CostRowProps {
  label: string
  amount: number
  percentage: number
  color: string
}

interface PricingRateRowProps {
  label: string
  rate: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type CostKey = "inputCost" | "outputCost" | "cacheReadCost" | "cacheCreation5mCost" | "cacheCreation1hCost"

const COST_CATEGORIES: { key: CostKey; label: string; color: string }[] = [
  { key: "inputCost", label: "Input", color: "bg-blue-500" },
  { key: "outputCost", label: "Output", color: "bg-emerald-500" },
  { key: "cacheReadCost", label: "Cache Read", color: "bg-amber-500" },
  { key: "cacheCreation5mCost", label: "Cache Write (5m)", color: "bg-violet-500" },
  { key: "cacheCreation1hCost", label: "Cache Write (1h)", color: "bg-pink-500" },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function aggregateCosts(turnsPricing: TurnPricing[]): Record<string, number> {
  const agg: Record<string, number> = {}
  for (const cat of COST_CATEGORIES) {
    agg[cat.key] = turnsPricing.reduce((sum, tp) => sum + (tp[cat.key] ?? 0), 0)
  }
  return agg
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CostRow({ label, amount, percentage, color }: CostRowProps) {
  if (amount === 0) return null

  return (
    <div className="flex items-center gap-3">
      <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-sm", color)} />
      <span className="w-28 shrink-0 text-xs text-text-muted">{label}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", color)}
          style={{ width: `${Math.max(percentage, 0.5)}%` }}
        />
      </div>
      <span className="w-16 shrink-0 text-right text-xs font-medium text-text-secondary">
        {formatCost(amount)}
      </span>
      <span className="w-12 shrink-0 text-right text-xs text-text-muted">
        {percentage.toFixed(1)}%
      </span>
    </div>
  )
}

function PricingRateRow({ label, rate }: PricingRateRowProps) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text-secondary">
        ${rate.toFixed(2)} / MTok
      </span>
    </div>
  )
}

function PerTurnTable({
  turns,
  turnsPricing,
}: {
  turns: Turn[]
  turnsPricing: TurnPricing[]
}) {
  if (turns.length === 0) return null

  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        Per-Turn Cost
      </h4>
      <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              <th className="px-2 py-1.5 text-left font-medium text-text-muted">#</th>
              <th className="px-2 py-1.5 text-right font-medium text-text-muted">Input</th>
              <th className="px-2 py-1.5 text-right font-medium text-text-muted">Output</th>
              <th className="px-2 py-1.5 text-right font-medium text-text-muted">Cache</th>
              <th className="px-2 py-1.5 text-right font-medium text-text-muted">Total</th>
            </tr>
          </thead>
          <tbody>
            {turnsPricing.map((tp, i) => (
              <tr
                key={turns[i]?.timestamp ?? i}
                className="border-b border-border/50 last:border-0 hover:bg-surface-2/50 transition-colors"
              >
                <td className="px-2 py-1.5 text-text-muted">{i + 1}</td>
                <td className="px-2 py-1.5 text-right text-text-secondary">
                  {formatCost(tp.inputCost)}
                </td>
                <td className="px-2 py-1.5 text-right text-text-secondary">
                  {formatCost(tp.outputCost)}
                </td>
                <td className="px-2 py-1.5 text-right text-text-secondary">
                  {formatCost(tp.cacheReadCost + tp.cacheCreation5mCost + tp.cacheCreation1hCost)}
                </td>
                <td className="px-2 py-1.5 text-right font-medium text-text-primary">
                  {formatCost(tp.totalCost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CostBreakdown({ pricing, turns, className }: CostBreakdownProps) {
  const { totalCost, turnsPricing, pricingRate } = pricing
  const aggregated = aggregateCosts(turnsPricing)

  return (
    <div className={cn("rounded-xl border border-border bg-background p-6", className)}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
          Cost Breakdown
        </h3>
        <span className="text-lg font-bold text-brand-400">{formatCost(totalCost)}</span>
      </div>

      {/* Cost category bars */}
      <div className="space-y-2">
        {COST_CATEGORIES.map((cat) => {
          const amount = aggregated[cat.key] ?? 0
          const pct = totalCost > 0 ? (amount / totalCost) * 100 : 0
          return (
            <CostRow
              key={cat.key}
              label={cat.label}
              amount={amount}
              percentage={pct}
              color={cat.color}
            />
          )
        })}
      </div>

      {/* Pricing rate */}
      <div className="mt-4 rounded-lg bg-surface-2 p-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Pricing Rate ({pricingRate.model})
        </h4>
        <div className="space-y-1">
          <PricingRateRow label="Input" rate={pricingRate.inputPerMTok} />
          <PricingRateRow label="Output" rate={pricingRate.outputPerMTok} />
          <PricingRateRow label="Cache Read" rate={pricingRate.cacheReadPerMTok} />
          <PricingRateRow label="Cache Write (5m)" rate={pricingRate.cacheCreation5mPerMTok} />
          <PricingRateRow label="Cache Write (1h)" rate={pricingRate.cacheCreation1hPerMTok} />
        </div>
      </div>

      {/* Per-turn table */}
      <div className="mt-4">
        <PerTurnTable turns={turns} turnsPricing={turnsPricing} />
      </div>
    </div>
  )
}
