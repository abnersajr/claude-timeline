import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { normalizeModelName } from "./model-parser.js"
import type { PricingFile, PricingRate, SessionMetadata, SessionPricing, Turn, TurnPricing } from "./types.js"

// ── Constants ──────────────────────────────────────────────────────────
const PRICING_DIR = join(homedir(), ".claude-timeline")
const PRICING_PATH = join(PRICING_DIR, "pricing.json")
const STALE_MS = 5 * 24 * 60 * 60 * 1000 // 5 days
const OPENROUTER_API = "https://openrouter.ai/api/v1/models"

// ── Fallback table (compiled in) ────────────────────────────────────────
const FALLBACK_TABLE: Record<string, PricingRate> = {
  "claude-opus-4-8": {
    model: "claude-opus-4-8",
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
  },
  "claude-opus-4-7": {
    model: "claude-opus-4-7",
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
  },
  "claude-sonnet-4-6": {
    model: "claude-sonnet-4-6",
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
  },
  "claude-haiku-4-5": {
    model: "claude-haiku-4-5",
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
    cacheReadPerMTok: 0.1,
    cacheWritePerMTok: 1.25,
  },
  "claude-opus-4-6": {
    model: "claude-opus-4-6",
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
  },
  "claude-opus-4-5": {
    model: "claude-opus-4-5",
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
  },
  "claude-opus-4-1": {
    model: "claude-opus-4-1",
    inputPerMTok: 15.0,
    outputPerMTok: 75.0,
    cacheReadPerMTok: 1.5,
    cacheWritePerMTok: 18.75,
  },
  "claude-opus-4": {
    model: "claude-opus-4",
    inputPerMTok: 15.0,
    outputPerMTok: 75.0,
    cacheReadPerMTok: 1.5,
    cacheWritePerMTok: 18.75,
  },
  "claude-sonnet-4-5": {
    model: "claude-sonnet-4-5",
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
  },
  "claude-sonnet-4": {
    model: "claude-sonnet-4",
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
  },
  "claude-sonnet-3-7": {
    model: "claude-sonnet-3-7",
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
  },
  "claude-haiku-3-5": {
    model: "claude-haiku-3-5",
    inputPerMTok: 0.8,
    outputPerMTok: 4.0,
    cacheReadPerMTok: 0.08,
    cacheWritePerMTok: 1.0,
  },
  "claude-haiku-3": {
    model: "claude-haiku-3",
    inputPerMTok: 0.25,
    outputPerMTok: 1.25,
    cacheReadPerMTok: 0.03,
    cacheWritePerMTok: 0.3,
  },
}

// ── OpenRouter API ─────────────────────────────────────────────────────

interface OpenRouterModel {
  id: string
  name: string
  pricing: {
    prompt: string
    completion: string
    input_cache_read?: string
    input_cache_write?: string
  }
}

/** Normalize OpenRouter model ID to our internal format */
function normalizeOpenRouterId(id: string): string {
  return id
    .replace(/^anthropic\//, "")  // strip provider prefix
    .replace(/\./g, "-")          // dots → hyphens
    .toLowerCase()
}

/** Parse OpenRouter pricing string to number, returns NaN if invalid */
function parsePrice(s: string | undefined): number {
  if (!s) return Number.NaN
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : Number.NaN
}

/** Fetch pricing from OpenRouter API */
export async function fetchFromOpenRouter(): Promise<Record<string, PricingRate>> {
  const res = await fetch(OPENROUTER_API, {
    headers: {
      "User-Agent": "claude-timeline/1.0",
      Accept: "application/json",
    },
  })

  if (!res.ok) {
    throw new Error(`OpenRouter API error: ${res.status} ${res.statusText}`)
  }

  const json = (await res.json()) as { data: OpenRouterModel[] }
  const models: Record<string, PricingRate> = {}

  for (const item of json.data) {
    // Only include Anthropic/Claude models
    if (!item.id.startsWith("anthropic/claude")) continue

    const prompt = parsePrice(item.pricing.prompt)
    const completion = parsePrice(item.pricing.completion)
    const cacheRead = parsePrice(item.pricing.input_cache_read)
    const cacheWrite = parsePrice(item.pricing.input_cache_write)

    // Skip if any required price is missing
    if ([prompt, completion, cacheRead, cacheWrite].some(Number.isNaN)) continue

    const model = normalizeOpenRouterId(item.id)
    models[model] = {
      model,
      inputPerMTok: prompt * 1_000_000,
      outputPerMTok: completion * 1_000_000,
      cacheReadPerMTok: cacheRead * 1_000_000,
      cacheWritePerMTok: cacheWrite * 1_000_000,
    }
  }

  if (Object.keys(models).length === 0) {
    throw new Error("No Claude models found in OpenRouter response")
  }

  return models
}

// ── Cache Management ───────────────────────────────────────────────────

/** Check if cached pricing data is stale (older than 5 days) */
export function isCacheStale(data: PricingFile): boolean {
  const fetchedAt = new Date(data.fetchedAt).getTime()
  return Date.now() - fetchedAt > STALE_MS
}

/** Load pricing file from disk, returns null if missing or invalid */
function loadPricingFile(): PricingFile | null {
  try {
    if (!existsSync(PRICING_PATH)) return null
    const raw = readFileSync(PRICING_PATH, "utf-8")
    const data = JSON.parse(raw) as PricingFile
    if (!data.fetchedAt || !data.models || Object.keys(data.models).length === 0) return null
    return data
  } catch {
    return null
  }
}

/** Save pricing file to disk */
export function savePricingFile(models: Record<string, PricingRate>): void {
  if (!existsSync(PRICING_DIR)) mkdirSync(PRICING_DIR, { recursive: true })
  const file: PricingFile = {
    fetchedAt: new Date().toISOString(),
    models,
  }
  writeFileSync(PRICING_PATH, JSON.stringify(file, null, 2) + "\n", "utf-8")
}

// ── Main Pricing Logic ─────────────────────────────────────────────────

/** Pricing table — loaded once at module init */
let PRICING_TABLE: Record<string, PricingRate> = FALLBACK_TABLE

/** Initialize pricing: load from cache or fetch from OpenRouter */
export async function initPricing(): Promise<void> {
  const cached = loadPricingFile()

  if (cached && !isCacheStale(cached)) {
    PRICING_TABLE = cached.models
    return
  }

  try {
    PRICING_TABLE = await fetchFromOpenRouter()
    savePricingFile(PRICING_TABLE)
  } catch (err) {
    console.warn(`Failed to fetch pricing from OpenRouter: ${(err as Error).message}`)
    if (cached) {
      console.warn("Using stale cached pricing data")
      PRICING_TABLE = cached.models
    } else {
      console.warn("Using compiled-in fallback pricing")
    }
  }
}

/** Force refresh pricing from OpenRouter (used by update-pricing CLI) */
export async function refreshPricing(): Promise<Record<string, PricingRate>> {
  const models = await fetchFromOpenRouter()
  savePricingFile(models)
  PRICING_TABLE = models
  return models
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
  const cacheWriteTokens = turn.tokenUsage.cacheCreation5mTokens + turn.tokenUsage.cacheCreation1hTokens
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * rate.cacheWritePerMTok
  const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost

  return {
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
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
