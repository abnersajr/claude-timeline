import { describe, expect, it } from "vitest"
import {
  categorizeContext,
  computeContextStats,
  detectCompactions,
  getInputTokens,
} from "../src/context-tracker"
import type { RawJsonlRecord } from "../src/types"

/** Helper to build a minimal RawJsonlRecord with overrides */
function makeRecord(overrides: Partial<RawJsonlRecord> = {}): RawJsonlRecord {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
    },
    ...overrides,
  }
}

describe("context-tracker", () => {
  // ── Test 1: detectCompactions returns correct phases ──
  describe("detectCompactions", () => {
    it("returns a single phase when no compact records exist", () => {
      const records = [
        makeRecord({ type: "user", message: { role: "user", content: "hi" } }),
        makeRecord({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
        }),
      ]

      const phases = detectCompactions(records)

      expect(phases).toHaveLength(1)
      expect(phases[0]).toEqual({
        phaseNumber: 1,
        startRecordIndex: 0,
        endRecordIndex: 1,
      })
    })

    it("splits into multiple phases around compact records", () => {
      const records = [
        makeRecord({ type: "user", message: { role: "user", content: "hi" } }),
        makeRecord({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
        }),
        makeRecord({ isCompactSummary: true }),
        makeRecord({ type: "user", message: { role: "user", content: "hi2" } }),
        makeRecord({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "hello2" }] },
        }),
      ]

      const phases = detectCompactions(records)

      expect(phases).toHaveLength(2)
      expect(phases[0]).toEqual({
        phaseNumber: 1,
        startRecordIndex: 0,
        endRecordIndex: 2,
      })
      expect(phases[1]).toEqual({
        phaseNumber: 2,
        startRecordIndex: 3,
        endRecordIndex: 4,
      })
    })
  })

  // ── Test 2: categorizeContext classifies records correctly ──
  describe("categorizeContext", () => {
    it("classifies user messages as user-message", () => {
      const record = makeRecord({
        type: "user",
        message: { role: "user", content: "hi" },
      })
      expect(categorizeContext(record)).toBe("user-message")
    })

    it("classifies meta user messages with tool_result as tool-output", () => {
      const record = makeRecord({
        type: "user",
        isMeta: true,
        message: {
          role: "user",
          content: [{ type: "tool_result", toolUseId: "1", content: "ok" }],
        },
      })
      expect(categorizeContext(record)).toBe("tool-output")
    })

    it("classifies assistant messages with tool_use as tool-output", () => {
      const record = makeRecord({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Read", input: {}, toolUseId: "1" }],
        },
      })
      expect(categorizeContext(record)).toBe("tool-output")
    })

    it("classifies assistant messages with thinking as thinking-text", () => {
      const record = makeRecord({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "thinking", text: "let me think" }],
        },
      })
      expect(categorizeContext(record)).toBe("thinking-text")
    })

    it("classifies compact records as compact", () => {
      const record = makeRecord({ isCompactSummary: true })
      expect(categorizeContext(record)).toBe("compact")
    })

    it("classifies assistant text-only messages as other", () => {
      const record = makeRecord({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "here is my response" }],
        },
      })
      expect(categorizeContext(record)).toBe("other")
    })
  })

  // ── Test 3: computeContextStats accumulates tokens by category ──
  describe("computeContextStats", () => {
    it("accumulates input tokens by category", () => {
      const records = [
        makeRecord({
          type: "user",
          message: {
            role: "user",
            content: "hi",
          },
        }),
        // Attach usage to a record
        makeRecord({
          type: "user",
          message: {
            role: "user",
            content: "hello world",
            usage: { input_tokens: 500 },
          },
        }),
        makeRecord({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", name: "Read", input: {}, toolUseId: "1" }],
            usage: { input_tokens: 1200 },
          },
        }),
        makeRecord({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "here is my response" }],
            usage: { input_tokens: 1500 },
          },
        }),
      ]

      const stats = computeContextStats(records)

      expect(stats.totalInputTokens).toBe(3200)
      expect(stats.tokensByCategory["user-message"]).toBe(500)
      expect(stats.tokensByCategory["tool-output"]).toBe(1200)
      expect(stats.tokensByCategory.other).toBe(1500)
      expect(stats.injections).toHaveLength(4)
      expect(stats.phaseCount).toBe(1)
    })

    it("tracks separate token totals per compaction phase", () => {
      const records = [
        makeRecord({
          type: "user",
          message: { role: "user", content: "first", usage: { input_tokens: 1000 } },
        }),
        makeRecord({ isCompactSummary: true }),
        makeRecord({
          type: "user",
          message: { role: "user", content: "second", usage: { input_tokens: 800 } },
        }),
      ]

      const stats = computeContextStats(records)

      // Both phases contribute to user-message tokens
      expect(stats.tokensByCategory["user-message"]).toBe(1800)
      expect(stats.totalInputTokens).toBe(1800)
      expect(stats.phaseCount).toBe(2) // phase 1 (with compact), phase 2
      expect(stats.injections[0].phaseNumber).toBe(1)
      expect(stats.injections[2].phaseNumber).toBe(2)
    })
  })

  // ── Test 4: getInputTokens extracts usage correctly ──
  describe("getInputTokens", () => {
    it("returns input_tokens when present", () => {
      const record = makeRecord({
        message: { role: "assistant", content: [], usage: { input_tokens: 4200 } },
      })
      expect(getInputTokens(record)).toBe(4200)
    })

    it("returns 0 when no message usage", () => {
      const record = makeRecord({
        message: { role: "assistant", content: [] },
      })
      expect(getInputTokens(record)).toBe(0)
    })

    it("returns 0 when no message", () => {
      const record = makeRecord({ message: undefined })
      expect(getInputTokens(record)).toBe(0)
    })
  })
})
