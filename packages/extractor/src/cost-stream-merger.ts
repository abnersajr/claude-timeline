/**
 * Merge cost-stream data into the extraction pipeline.
 *
 * This module provides functions to enrich SessionPricing with ground-truth
 * cost data from the cost-stream.db, preserving both estimated and API streams.
 */

import { CostStreamDb } from "./cost-stream-db.js"
import type {
  FullTimelineSession,
  SessionPricing,
} from "./types.js"

// ─── Types ───────────────────────────────────────────────────────────

/** Cost-stream enrichment result */
export interface CostStreamEnrichment {
  totalCostUsd: number
  snapshotCount: number
  firstSnapshotAt: string | null
  lastSnapshotAt: string | null
  model: string | null
}

// ─── Database Access ─────────────────────────────────────────────────

/**
 * Get cost-stream enrichment for a session.
 * Returns null if no cost-stream data exists.
 */
export function getCostEnrichment(
  costStreamDbPath: string,
  sessionId: string,
): CostStreamEnrichment | null {
  const db = new CostStreamDb(costStreamDbPath)
  try {
    const summary = db.getCostSummary(sessionId)
    if (!summary) return null

    return {
      totalCostUsd: summary.total_cost_usd,
      snapshotCount: summary.snapshot_count,
      firstSnapshotAt: summary.first_snapshot_at,
      lastSnapshotAt: summary.last_snapshot_at,
      model: summary.model,
    }
  } finally {
    db.close()
  }
}

// ─── Enrichment Functions ────────────────────────────────────────────

/**
 * Build SessionPricing using both cost streams.
 *
 * - Estimated stream (from JSONL × pricing rates) is always preserved
 * - API stream (from cost-stream.db) is added when available
 * - totalCost prefers API when available, falls back to estimated
 */
export function buildSessionPricing(
  estimatedPricing: SessionPricing,
  enrichment: CostStreamEnrichment | null,
): SessionPricing {
  if (!enrichment) {
    return {
      ...estimatedPricing,
      estimatedTotalCost: estimatedPricing.estimatedTotalCost ?? estimatedPricing.totalCost,
      apiTotalCost: null,
      apiSnapshotCount: 0,
      apiLastSnapshotAt: null,
      costSource: "estimated",
    }
  }

  return {
    ...estimatedPricing,
    // Estimated stream stays as-is (from JSONL × pricing)
    estimatedTotalCost: estimatedPricing.estimatedTotalCost ?? estimatedPricing.totalCost,
    // API stream from cost-stream.db
    apiTotalCost: enrichment.totalCostUsd,
    apiSnapshotCount: enrichment.snapshotCount,
    apiLastSnapshotAt: enrichment.lastSnapshotAt,
    // Primary total: prefer API when available
    totalCost: enrichment.totalCostUsd,
    costSource: "api",
  }
}

/**
 * Enrich a FullTimelineSession with cost-stream data.
 *
 * This is the main merge function. It:
 * 1. Gets cost-stream data (if available)
 * 2. Sets both estimated and API cost streams
 * 3. Marks the cost source
 */
export function enrichTimelineWithCostStream(
  timeline: FullTimelineSession,
  costStreamDbPath: string,
): FullTimelineSession {
  const enrichment = getCostEnrichment(costStreamDbPath, timeline.session.sessionId)

  if (!enrichment) {
    return {
      ...timeline,
      pricing: {
        ...timeline.pricing,
        estimatedTotalCost: timeline.pricing.estimatedTotalCost ?? timeline.pricing.totalCost,
        apiTotalCost: null,
        apiSnapshotCount: 0,
        apiLastSnapshotAt: null,
        costSource: "estimated",
      },
    }
  }

  const enrichedPricing = buildSessionPricing(timeline.pricing, enrichment)

  return {
    ...timeline,
    session: {
      ...timeline.session,
      costCaptureAvailable: true,
    },
    pricing: enrichedPricing,
  }
}
