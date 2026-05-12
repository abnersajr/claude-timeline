/**
 * Zod schemas for API types.
 * Runtime validators + TypeScript type sources.
 *
 * Convention: export both schema and inferred type for each entity.
 * Use z.any() for complex nested types (defer detailed schemas).
 */
import { z } from "zod/v4"

// ─── Token Usage ────────────────────────────────────────────────────

/** Token breakdown per turn */
export const TokenUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheCreation5mTokens: z.number(),
  cacheCreation1hTokens: z.number(),
  cacheCreationTokens: z.number().optional(),
})

export type TokenUsage = z.infer<typeof TokenUsageSchema>

// ─── Turn Pricing ───────────────────────────────────────────────────

/** Per-turn cost breakdown */
export const TurnPricingSchema = z.object({
  inputCost: z.number(),
  outputCost: z.number(),
  cacheReadCost: z.number(),
  cacheCreation5mCost: z.number(),
  cacheCreation1hCost: z.number(),
  totalCost: z.number(),
})

export type TurnPricing = z.infer<typeof TurnPricingSchema>

// ─── Session Summary ────────────────────────────────────────────────

/** GET /api/sessions response items */
export const SessionSummarySchema = z.object({
  sessionId: z.string(),
  projectName: z.string(),
  model: z.string(),
  workingDirectory: z.string(),
  turnCount: z.number(),
  totalTokens: TokenUsageSchema,
  startTime: z.string(),
  endTime: z.string(),
  isOngoing: z.boolean(),
  totalCost: z.number(),
  costCaptureAvailable: z.boolean().optional(),
  estimatedTotalCost: z.number().optional(),
  apiTotalCost: z.number().nullable().optional(),
})

export type SessionSummary = z.infer<typeof SessionSummarySchema>

// ─── Full Timeline Session ──────────────────────────────────────────

/**
 * GET /api/sessions/:id response
 * Deep nested types (Turn, SessionPricing, etc.) use z.any() for now.
 */
export const FullTimelineSessionSchema = z.object({
  session: z.object({
    sessionId: z.string(),
    projectName: z.string(),
    model: z.string(),
    commandExecuted: z.string().optional(),
    workingDirectory: z.string(),
    turnCount: z.number(),
    totalTokens: TokenUsageSchema,
    startTime: z.string(),
    endTime: z.string(),
    isOngoing: z.boolean(),
    activeDurationMs: z.number().optional(),
    costCaptureAvailable: z.boolean().optional(),
  }),
  turns: z.array(z.any()),
  pricing: z.any(),
  contextStats: z.any().optional(),
  subagents: z.array(z.any()).optional(),
  conversationGroups: z.array(z.any()).optional(),
})

export type FullTimelineSession = z.infer<typeof FullTimelineSessionSchema>

// ─── Error Response ─────────────────────────────────────────────────

/** Standard error response */
export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  statusCode: z.number(),
})

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>

// ─── Health Response ────────────────────────────────────────────────

/** Health check response */
export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded", "down"]),
  version: z.string(),
  uptime: z.number(),
  timestamp: z.string(),
})

export type HealthResponse = z.infer<typeof HealthResponseSchema>
