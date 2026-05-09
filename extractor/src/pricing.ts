import type { PricingRate, SessionMetadata, SessionPricing, Turn, TurnPricing } from "./types.js"

const PRICING_TABLE: Record<string, PricingRate> = {
  "claude-sonnet-4-6": {
    model: "claude-sonnet-4-6",
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
  "claude-opus-4": {
    model: "claude-opus-4",
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    cacheReadPerMTok: 0.5,
    cacheCreation5mPerMTok: 6.25,
    cacheCreation1hPerMTok: 10.0,
  },
}

/**
 * Look up pricing for a model.
 * Falls back to claude-sonnet-4-6 rates if unknown.
 */
export function getPricing(modelName: string): PricingRate {
  const rate = PRICING_TABLE[modelName]
  if (rate) return rate

  console.warn(`Unknown model "${modelName}", falling back to claude-sonnet-4-6 rates`)
  return { ...PRICING_TABLE["claude-sonnet-4-6"], model: modelName }
}

/**
 * Calculate per-turn cost breakdown
 */
function calculateTurnCost(turn: Turn, rate: PricingRate): TurnPricing {
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
  const rate = getPricing(session.model)
  const turnsPricing = turns.map((turn) => calculateTurnCost(turn, rate))
  const totalCost = turnsPricing.reduce((sum, t) => sum + t.totalCost, 0)

  return { totalCost, turnsPricing, pricingRate: rate }
}
