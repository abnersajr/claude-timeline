import { useCallback, useState } from "react"
import type {
  Turn,
  TurnPricing,
  SessionPricing,
} from "@claude-timeline/types"
import { cn, formatCost, formatTokens, modelTier } from "@/lib/utils"
import { buildSessionSteps } from "@/lib/steps"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CostBreakdownProps {
  pricing: SessionPricing & {
    estimatedTotalCost?: number
    apiTotalCost?: number | null
    costSource?: "api" | "estimated"
  }
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

interface ModelTabProps {
  model: string
  cost: number
  totalCost: number
  isActive: boolean
  isMain: boolean
  onClick: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type CostKey = "inputCost" | "outputCost" | "cacheReadCost" | "cacheWriteCost"

const COST_CATEGORIES: { key: CostKey; label: string; color: string }[] = [
  { key: "inputCost", label: "Input", color: "bg-blue-500" },
  { key: "outputCost", label: "Output", color: "bg-emerald-500" },
  { key: "cacheReadCost", label: "Cache Read", color: "bg-amber-500" },
  { key: "cacheWriteCost", label: "Cache Write", color: "bg-violet-500" },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize model name: strip provider prefix, date suffix, lowercase */
function normalizeModelName(raw: string): string {
  if (!raw) return "unknown"
  return raw
    .replace(/^anthropic\//, "")
    .replace(/-\d{8}$/, "")
    .toLowerCase()
}

function aggregateCosts(turnsPricing: TurnPricing[]): Record<string, number> {
  const agg: Record<string, number> = {}
  for (const cat of COST_CATEGORIES) {
    agg[cat.key] = turnsPricing.reduce((sum, tp) => sum + (tp[cat.key] ?? 0), 0)
  }
  return agg
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

function getPricingRateForModel(model: string): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  // Map normalized model names to pricing rates
  const rates: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
    "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
    "claude-sonnet-4-5": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
    "claude-sonnet-4": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
    "claude-sonnet-3-7": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
    "claude-haiku-4-5": { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
    "claude-haiku-3-5": { input: 0.8, output: 4.0, cacheRead: 0.08, cacheWrite: 1.0 },
    "claude-haiku-3": { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },
    "claude-opus-4-7": { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
    "claude-opus-4-6": { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
    "claude-opus-4-5": { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
    "claude-opus-4-1": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
    "claude-opus-4": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  }
  return rates[model] ?? rates["claude-sonnet-4-6"]!
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CostRow({ label, amount, percentage, color, cacheWriteTypes }: CostRowProps & { cacheWriteTypes?: Set<string> }) {
  if (amount === 0) return null

  return (
    <div className="flex items-center gap-3">
      <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-sm", color)} />
      <span className="w-28 shrink-0 text-xs text-text-muted flex items-center">
        {label}
        {cacheWriteTypes && cacheWriteTypes.size > 0 && (
          <CacheWriteTypeBadge types={cacheWriteTypes} />
        )}
      </span>
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

function ModelTab({ model, cost, totalCost, isActive, isMain, onClick }: ModelTabProps) {
  const pct = totalCost > 0 ? (cost / totalCost) * 100 : 0
  // Shorten model name for display
  const shortModel = model
    .replace("claude-", "")
    .replace(/-\d{8}$/, "")
    .replace(/-\d+$/, "")

  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2",
        isActive
          ? "border-primary text-foreground"
          : "border-transparent text-text-muted hover:text-foreground hover:border-border"
      )}
      onClick={onClick}
    >
      <span className={`capitalize model-${modelTier(model)}`}>{shortModel}</span>
      {isMain && (
        <span className="text-[0.625rem] text-text-muted">(main)</span>
      )}
      <span className="text-xs text-text-muted">
        {formatCost(cost)}
      </span>
      <span className="text-[0.625rem] text-text-muted">
        {pct.toFixed(0)}%
      </span>
    </button>
  )
}

function PerStepTable({
  turns,
  turnsPricing,
  cacheWriteTypes,
}: {
  turns: Turn[]
  turnsPricing: TurnPricing[]
  cacheWriteTypes: Set<string>
}) {
  const { steps, nonZeroCostSteps } = buildSessionSteps(turns, turnsPricing)

  const handleClick = useCallback((stepIndex: number) => {
    const el = document.getElementById(`step-S${stepIndex + 1}`)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    // Flash highlight
    el.classList.add("step-flash")
    setTimeout(() => el.classList.remove("step-flash"), 2000)
  }, [])

  if (nonZeroCostSteps.length === 0) return null

  // Running cumulative total
  let cumulative = 0

  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        Per-Step Cost
      </h4>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              <th className="px-2 py-1.5 text-left font-medium text-text-muted">Step</th>
              <th className="px-2 py-1.5 text-right font-medium text-text-muted">Input</th>
              <th className="px-2 py-1.5 text-right font-medium text-text-muted">Output</th>
              <th className="px-2 py-1.5 text-right font-medium text-text-muted">CR</th>
              <th className="px-2 py-1.5 text-right font-medium text-text-muted">
                <span className="flex items-center justify-end gap-0.5">
                  CW
                  <CacheWriteTypeBadge types={cacheWriteTypes} />
                </span>
              </th>
              <th className="px-2 py-1.5 text-right font-medium text-text-muted">Total</th>
              <th className="px-2 py-1.5 text-right font-medium text-text-muted">Cumul.</th>
            </tr>
          </thead>
          <tbody>
            {nonZeroCostSteps.map((step, _filteredIdx) => {
              // Find the original step index in the full steps array for the ID
              const originalIdx = steps.indexOf(step)
              cumulative += step.totalCost

              return (
                <tr
                  key={step.anchor.timestamp}
                  onClick={() => handleClick(originalIdx)}
                  className="border-b border-border/50 last:border-0 hover:bg-surface-2/50 transition-colors cursor-pointer"
                >
                  <td className="px-2 py-1.5">
                    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-bold text-primary">
                      S{originalIdx + 1}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right text-text-secondary">
                    {formatCost(step.inputCost)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-text-secondary">
                    {formatCost(step.outputCost)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-text-secondary">
                    {formatCost(step.cacheReadCost)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-text-secondary">
                    {formatCost(step.cacheWriteCost)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold text-emerald-500">
                    {formatCost(step.totalCost)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold text-emerald-500">
                    +{formatCost(cumulative)}
                  </td>
                </tr>
              )
            })}
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
  const { totalCost, turnsPricing, pricingRate, modelBreakdown } = pricing
  const aggregated = aggregateCosts(turnsPricing)
  const cacheWriteTypes = computeCacheWriteTypes(turns)

  // Build model tabs from modelBreakdown
  const models = Object.entries(modelBreakdown).sort((a, b) => b[1].cost - a[1].cost)
  const [activeModel, setActiveModel] = useState<string | null>(null)

  // Get the pricing rate for the active model
  const activeModelRate = activeModel ? getPricingRateForModel(activeModel) : null
  const activeModelBreakdown = activeModel ? modelBreakdown[activeModel] : null

  return (
    <div className={cn("rounded-xl border border-border bg-background p-6", className)}>
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
            Cost Breakdown
          </h3>
          <div className="flex items-center gap-3">
            {pricing.apiTotalCost != null && (
              <span className="inline-flex items-center gap-1.5 text-sm">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="font-bold text-brand-400">{formatCost(pricing.apiTotalCost)}</span>
                <span className="text-[0.625rem] text-text-muted">API</span>
              </span>
            )}
            {pricing.apiTotalCost != null &&
              pricing.estimatedTotalCost != null &&
              pricing.apiTotalCost !== pricing.estimatedTotalCost && (
                <span className="text-text-muted">/</span>
              )}
            {pricing.estimatedTotalCost != null && (
              <span className="inline-flex items-center gap-1.5 text-sm">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                <span className="font-medium text-text-secondary">{formatCost(pricing.estimatedTotalCost)}</span>
                <span className="text-[0.625rem] text-text-muted">est.</span>
              </span>
            )}
            {pricing.apiTotalCost == null && pricing.estimatedTotalCost == null && (
              <span className="text-lg font-bold text-brand-400">{formatCost(totalCost)}</span>
            )}
          </div>
        </div>
        {/* Difference indicator */}
        {pricing.apiTotalCost != null &&
          pricing.estimatedTotalCost != null &&
          pricing.apiTotalCost !== pricing.estimatedTotalCost && (() => {
            const diff = pricing.apiTotalCost - pricing.estimatedTotalCost
            const pct = pricing.estimatedTotalCost > 0
              ? (diff / pricing.estimatedTotalCost) * 100
              : 0
            return (
              <p className="mt-1 text-[0.625rem] text-text-muted">
                {diff > 0 ? "+" : ""}{pct.toFixed(1)}% difference
                {pricing.costSource === "api" ? " — using API total" : " — using estimated"}
              </p>
            )
          })()}
      </div>

      {/* Model tabs */}
      {models.length > 1 && (
        <div className="flex gap-0 border-b border-border mb-4 overflow-x-auto">
          <button
            type="button"
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2",
              activeModel === null
                ? "border-primary text-foreground"
                : "border-transparent text-text-muted hover:text-foreground hover:border-border"
            )}
            onClick={() => setActiveModel(null)}
          >
            All Models
            <span className="text-xs text-text-muted">{formatCost(totalCost)}</span>
          </button>
          {models.map(([model, data]) => (
            <ModelTab
              key={model}
              model={model}
              cost={data.cost}
              totalCost={totalCost}
              isActive={activeModel === model}
              isMain={model === normalizeModelName(pricingRate.model)}
              onClick={() => setActiveModel(model)}
            />
          ))}
        </div>
      )}

      {/* Content area */}
      {activeModel === null ? (
        // All Models view
        <>
          {/* Cost category bars */}
          <div className="space-y-2">
            {COST_CATEGORIES.map((cat) => {
              const amount = aggregated[cat.key] ?? 0
              const pct = totalCost > 0 ? (amount / totalCost) * 100 : 0
              const isCacheWrite = cat.key === "cacheWriteCost"
              return (
                <CostRow
                  key={cat.key}
                  label={cat.label}
                  amount={amount}
                  percentage={pct}
                  color={cat.color}
                  cacheWriteTypes={isCacheWrite ? cacheWriteTypes : undefined}
                />
              )
            })}
          </div>

          {/* Model summary */}
          {models.length > 1 && (
            <div className="mt-4 rounded-lg bg-surface-2 p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Models Used
              </h4>
              <div className="space-y-1.5">
                {models.map(([model, data]) => {
                  const pct = totalCost > 0 ? (data.cost / totalCost) * 100 : 0
                  const isMain = model === normalizeModelName(pricingRate.model)
                  return (
                    <div key={model} className="flex items-center justify-between text-sm">
                      <span className={`text-text-secondary model-${modelTier(model)} px-1.5 py-0.5 rounded border`}>
                        {model}
                        {isMain && <span className="text-[0.625rem] text-text-muted ml-1">(main)</span>}
                        {!isMain && <span className="text-[0.625rem] text-text-muted ml-1">({data.turnCount} turns)</span>}
                      </span>
                      <span className="font-medium text-text-primary">
                        {formatCost(data.cost)} <span className="text-[0.625rem] text-text-muted">{pct.toFixed(1)}%</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        // Single model view
        activeModelBreakdown && (
          <>
            {/* Cost bars for this model */}
            <div className="space-y-2">
              <CostRow
                label="Input"
                amount={(activeModelBreakdown.inputTokens / 1_000_000) * (activeModelRate?.input ?? 3)}
                percentage={activeModelBreakdown.cost > 0 ? ((activeModelBreakdown.inputTokens / 1_000_000 * (activeModelRate?.input ?? 3)) / activeModelBreakdown.cost) * 100 : 0}
                color="bg-blue-500"
              />
              <CostRow
                label="Output"
                amount={(activeModelBreakdown.outputTokens / 1_000_000) * (activeModelRate?.output ?? 15)}
                percentage={activeModelBreakdown.cost > 0 ? ((activeModelBreakdown.outputTokens / 1_000_000 * (activeModelRate?.output ?? 15)) / activeModelBreakdown.cost) * 100 : 0}
                color="bg-emerald-500"
              />
              <CostRow
                label="Cache Read"
                amount={(activeModelBreakdown.cacheReadTokens / 1_000_000) * (activeModelRate?.cacheRead ?? 0.3)}
                percentage={activeModelBreakdown.cost > 0 ? ((activeModelBreakdown.cacheReadTokens / 1_000_000 * (activeModelRate?.cacheRead ?? 0.3)) / activeModelBreakdown.cost) * 100 : 0}
                color="bg-amber-500"
              />
              <CostRow
                label="Cache Write"
                amount={(activeModelBreakdown.cacheCreationTokens / 1_000_000) * (activeModelRate?.cacheWrite ?? 3.75)}
                percentage={activeModelBreakdown.cost > 0 ? ((activeModelBreakdown.cacheCreationTokens / 1_000_000 * (activeModelRate?.cacheWrite ?? 3.75)) / activeModelBreakdown.cost) * 100 : 0}
                color="bg-violet-500"
                cacheWriteTypes={cacheWriteTypes}
              />
            </div>

            {/* Pricing rate for this model */}
            {activeModelRate && (
              <div className="mt-4 rounded-lg bg-surface-2 p-3">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Pricing Rate — {activeModel}
                </h4>
                <div className="space-y-1">
                  <PricingRateRow label="Input" rate={activeModelRate.input} />
                  <PricingRateRow label="Output" rate={activeModelRate.output} />
                  <PricingRateRow label="Cache Read" rate={activeModelRate.cacheRead} />
                  <PricingRateRow label="Cache Write" rate={activeModelRate.cacheWrite} />
                </div>
              </div>
            )}

            {/* Token summary for this model */}
            <div className="mt-3 rounded-lg bg-surface-2 p-3">
              <div className="flex items-center gap-4 text-xs text-text-muted">
                <span>Turns: <span className="font-medium text-text-secondary">{activeModelBreakdown.turnCount}</span></span>
                <span>Input: <span className="font-medium text-text-secondary">{formatTokens(activeModelBreakdown.inputTokens)}</span></span>
                <span>Output: <span className="font-medium text-text-secondary">{formatTokens(activeModelBreakdown.outputTokens)}</span></span>
                <span>Cache Read: <span className="font-medium text-text-secondary">{formatTokens(activeModelBreakdown.cacheReadTokens)}</span></span>
              </div>
            </div>
          </>
        )
      )}

      {/* Per-step table */}
      <div className="mt-4">
        {pricing.apiTotalCost != null && (
          <p className="mb-2 text-[0.625rem] text-text-muted italic">
            Per-step costs based on JSONL estimation (API provides session-level total only)
          </p>
        )}
        <PerStepTable turns={turns} turnsPricing={turnsPricing} cacheWriteTypes={cacheWriteTypes} />
      </div>
    </div>
  )
}
