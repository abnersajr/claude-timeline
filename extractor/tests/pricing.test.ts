import { describe, expect, test } from "vitest"
import { calculateSessionCost, getPricing } from "../src/pricing.js"
import type { SessionMetadata, Turn } from "../src/types.js"

describe("getPricing", () => {
  test("returns correct rates for claude-sonnet-4-6", () => {
    const rate = getPricing("claude-sonnet-4-6")
    expect(rate.model).toBe("claude-sonnet-4-6")
    expect(rate.inputPerMTok).toBe(3.0)
    expect(rate.outputPerMTok).toBe(15.0)
    expect(rate.cacheReadPerMTok).toBe(0.3)
    expect(rate.cacheCreation5mPerMTok).toBe(3.75)
    expect(rate.cacheCreation1hPerMTok).toBe(6.0)
  })

  test("returns correct rates for claude-sonnet-4", () => {
    const rate = getPricing("claude-sonnet-4")
    expect(rate.model).toBe("claude-sonnet-4")
    expect(rate.inputPerMTok).toBe(3.0)
  })

  test("returns correct rates for claude-opus-4", () => {
    const rate = getPricing("claude-opus-4")
    expect(rate.model).toBe("claude-opus-4")
    expect(rate.inputPerMTok).toBe(5.0)
    expect(rate.outputPerMTok).toBe(25.0)
    expect(rate.cacheReadPerMTok).toBe(0.5)
    expect(rate.cacheCreation5mPerMTok).toBe(6.25)
    expect(rate.cacheCreation1hPerMTok).toBe(10.0)
  })

  test("falls back to sonnet-4-6 rates for unknown model", () => {
    const rate = getPricing("unknown-model")
    expect(rate.model).toBe("unknown-model")
    expect(rate.inputPerMTok).toBe(3.0)
    expect(rate.outputPerMTok).toBe(15.0)
  })
})

describe("calculateSessionCost", () => {
  const mockSession: SessionMetadata = {
    sessionId: "test-id",
    projectName: "test",
    model: "claude-sonnet-4-6",
    workingDirectory: "/test",
    turnCount: 2,
    totalTokens: {
      inputTokens: 30,
      outputTokens: 14550,
      cacheReadTokens: 929057,
      cacheCreation5mTokens: 34383,
      cacheCreation1hTokens: 0,
    },
    startTime: "2026-05-07T19:22:45.118Z",
    endTime: "2026-05-07T19:50:00.000Z",
  }

  const mockTurns: Turn[] = [
    {
      timestamp: "2026-05-07T19:22:45.118Z",
      tokenUsage: {
        inputTokens: 2,
        outputTokens: 323,
        cacheReadTokens: 12143,
        cacheCreation5mTokens: 12973,
        cacheCreation1hTokens: 0,
      },
      messages: [],
      toolCalls: [],
      cacheWriteType: "5m",
      cacheReadType: "5m",
      cacheCreationTokensThisTurn: 12973,
    },
    {
      timestamp: "2026-05-07T19:22:52.379Z",
      tokenUsage: {
        inputTokens: 1,
        outputTokens: 222,
        cacheReadTokens: 25116,
        cacheCreation5mTokens: 410,
        cacheCreation1hTokens: 0,
      },
      messages: [],
      toolCalls: [],
      cacheWriteType: "5m",
      cacheReadType: "5m",
      cacheCreationTokensThisTurn: 410,
    },
  ]

  test("returns totalCost > 0 with real data", () => {
    const result = calculateSessionCost(mockSession, mockTurns)
    expect(result.totalCost).toBeGreaterThan(0)
  })

  test("returns zero cost with zero tokens", () => {
    const zeroSession: SessionMetadata = {
      ...mockSession,
      totalTokens: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
      },
    }
    const zeroTurns: Turn[] = [
      {
        timestamp: "2026-05-07T19:22:45.118Z",
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreation5mTokens: 0,
          cacheCreation1hTokens: 0,
        },
        messages: [],
        toolCalls: [],
        cacheWriteType: "none",
        cacheReadType: "unknown",
        cacheCreationTokensThisTurn: 0,
      },
    ]
    const result = calculateSessionCost(zeroSession, zeroTurns)
    expect(result.totalCost).toBe(0)
  })

  test("per-turn cost breakdown matches manual calculation", () => {
    const result = calculateSessionCost(mockSession, mockTurns)
    expect(result.turnsPricing).toHaveLength(2)

    // Turn 1: input=2, output=323, cacheRead=12143, cacheCreation5m=12973
    const turn1 = result.turnsPricing[0]
    expect(turn1.inputCost).toBeCloseTo((2 / 1_000_000) * 3.0)
    expect(turn1.outputCost).toBeCloseTo((323 / 1_000_000) * 15.0)
    expect(turn1.cacheReadCost).toBeCloseTo((12143 / 1_000_000) * 0.3)
    expect(turn1.cacheCreation5mCost).toBeCloseTo((12973 / 1_000_000) * 3.75)
    expect(turn1.totalCost).toBeCloseTo(
      turn1.inputCost +
        turn1.outputCost +
        turn1.cacheReadCost +
        turn1.cacheCreation5mCost +
        turn1.cacheCreation1hCost,
    )
  })

  test("totalCost equals sum of all turn costs", () => {
    const result = calculateSessionCost(mockSession, mockTurns)
    const sumOfTurns = result.turnsPricing.reduce((sum, t) => sum + t.totalCost, 0)
    expect(result.totalCost).toBeCloseTo(sumOfTurns)
  })

  test("includes pricing rate in result", () => {
    const result = calculateSessionCost(mockSession, mockTurns)
    expect(result.pricingRate.model).toBe("claude-sonnet-4-6")
  })
})
