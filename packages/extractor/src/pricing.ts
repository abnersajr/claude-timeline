import { normalizeModelName } from "./model-parser.js"
import type { PricingRate, SessionMetadata, SessionPricing, Turn, TurnPricing } from "./types.js"

const PRICING_TABLE: Record<string, PricingRate> = {
  // ── Latest models ──────────────────────────────────────────────
  "claude-opus-4-7": {
    model: "claude-opus-4-7",
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    cacheReadPerMTok: 0.5,
    cacheCreation5mPerMTok: 6.25,
    cacheCreation1hPerMTok: 10.0,
  },
  "claude-sonnet-4-6": {
    model: "claude-sonnet-4-6",
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheReadPerMTok: 0.3,
    cacheCreation5mPerMTok: 3.75,
    cacheCreation1hPerMTok: 6.0,
  },
  "claude-haiku-4-5": {
    model: "claude-haiku-4-5",
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
    cacheReadPerMTok: 0.1,
    cacheCreation5mPerMTok: 1.25,
    cacheCreation1hPerMTok: 2.0,
  },

  // ── Legacy models ──────────────────────────────────────────────
  "claude-opus-4-6": {
    model: "claude-opus-4-6",
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    cacheReadPerMTok: 0.5,
    cacheCreation5mPerMTok: 6.25,
    cacheCreation1hPerMTok: 10.0,
  },
  "claude-opus-4-5": {
    model: "claude-opus-4-5",
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    cacheReadPerMTok: 0.5,
    cacheCreation5mPerMTok: 6.25,
    cacheCreation1hPerMTok: 10.0,
  },
  "claude-opus-4-1": {
    model: "claude-opus-4-1",
    inputPerMTok: 15.0,
    outputPerMTok: 75.0,
    cacheReadPerMTok: 1.5,
    cacheCreation5mPerMTok: 18.75,
    cacheCreation1hPerMTok: 30.0,
  },
  "claude-opus-4": {
    model: "claude-opus-4",
    inputPerMTok: 15.0,
    outputPerMTok: 75.0,
    cacheReadPerMTok: 1.5,
    cacheCreation5mPerMTok: 18.75,
    cacheCreation1hPerMTok: 30.0,
  },
  "claude-sonnet-4-5": {
    model: "claude-sonnet-4-5",
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheReadPerMTok: 0.3,
    cacheCreation5mPerMTok: 3.75,
    cacheCreation1hPerMTok: 6.0,
  },
  "claude-sonnet-4": {
    model: "claude-sonnet-4",
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheReadPerMTok: 0.3,
    cacheCreation5mPerMTok: 3.75,
    cacheCreation1hPerMTok: 6.0,
  },
  "claude-sonnet-3-7": {
    model: "claude-sonnet-3-7",
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheReadPerMTok: 0.3,
    cacheCreation5mPerMTok: 3.75,
    cacheCreation1hPerMTok: 6.0,
  },
  "claude-haiku-3-5": {
    model: "claude-haiku-3-5",
    inputPerMTok: 0.8,
    outputPerMTok: 4.0,
    cacheReadPerMTok: 0.08,
    cacheCreation5mPerMTok: 1.0,
    cacheCreation1hPerMTok: 1.6,
  },
  "claude-haiku-3": {
    model: "claude-haiku-3",
    inputPerMTok: 0.25,
    outputPerMTok: 1.25,
    cacheReadPerMTok: 0.03,
    cacheCreation5mPerMTok: 0.3,
    cacheCreation1hPerMTok: 0.5,
  },
}

/**
 * Look up pricing for a model.
 * Falls back to claude-sonnet-4-6 rates if unknown.
 */
export function getPricing(modelName: string): PricingRate {
  const normalized = normalizeModelName(modelName)
  const rate = PRICING_TABLE[normalized]
  if (rate) return rate

  console.warn(`Unknown model "${normalized}" (raw: "${modelName}"), falling back to claude-sonnet-4-6 rates`)
  return { ...PRICING_TABLE["claude-sonnet-4-6"], model: normalized }
}

/**
 * Calculate per-turn cost breakdown.
 * Uses turn-level model detection when available, otherwise falls back to session default rate.
 */
export function calculateTurnCost(turn: Turn, sessionRate: PricingRate): TurnPricing {
  const rate = turn.model
    ? getPricing(normalizeModelName(turn.model))
    : sessionRate

  const inputCost = (turn.tokenUsage.inputTokens / 1_000_000) * rate.inputPerMTok
  const outputCost = (turn.tokenUsage.outputTokens / 1_000_000) * rate.outputPerMTok
  const cacheReadCost = (turn.tokenUsage.cacheReadTokens / 1_000_000) * rate.cacheReadPerMTok
  const cacheCreation5mCost =
    (turn.tokenUsage.cacheCreation5mTokens / 1_000_000) * rate.cacheCreation5mPerMTok
  const cacheCreation1hCost =
    (turn.tokenUsage.cacheCreation1hTokens / 1_000_000) * rate.cacheCreation1hPerMTok
  const totalCost =
    inputCost + outputCost + cacheReadCost + cacheCreation5mCost + cacheCreation1hCost

  return {
    inputCost,
    outputCost,
    cacheReadCost,
    cacheCreation5mCost,
    cacheCreation1hCost,
    totalCost,
  }
}

/**
 * Calculate full session pricing from session metadata and turns
 */
export function calculateSessionCost(session: SessionMetadata, turns: Turn[]): SessionPricing {
  const rate = getPricing(normalizeModelName(session.model))
  const turnsPricing = turns.map((turn) => calculateTurnCost(turn, rate))
  const totalCost = turnsPricing.reduce((sum, t) => sum + t.totalCost, 0)

  // Compute per-model breakdown
  const modelBreakdown: SessionPricing["modelBreakdown"] = {}
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]
    const pricing = turnsPricing[i]
    const model = normalizeModelName(turn.model ?? session.model)

    if (!modelBreakdown[model]) {
      modelBreakdown[model] = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        cost: 0,
        turnCount: 0,
      }
    }

    const entry = modelBreakdown[model]
    entry.inputTokens += turn.tokenUsage.inputTokens
    entry.outputTokens += turn.tokenUsage.outputTokens
    entry.cacheReadTokens += turn.tokenUsage.cacheReadTokens
    entry.cacheCreationTokens += turn.tokenUsage.cacheCreation5mTokens + turn.tokenUsage.cacheCreation1hTokens
    entry.cost += pricing.totalCost
    entry.turnCount++
  }

  return {
    estimatedTotalCost: totalCost,
    turnsPricing,
    apiTotalCost: null,
    apiSnapshotCount: 0,
    apiLastSnapshotAt: null,
    totalCost,
    costSource: "estimated",
    modelBreakdown,
    pricingRate: rate,
  }
}
