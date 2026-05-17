import { describe, expect, it } from "vitest"
import { normalizeModelName, parseModelName } from "./model-parser"

describe("parseModelName", () => {
  it("strips provider prefix", () => {
    expect(parseModelName("anthropic/claude-sonnet-4-20250514")).toBe("claude-sonnet-4")
  })

  it("strips date suffix", () => {
    expect(parseModelName("claude-sonnet-4-20250514")).toBe("claude-sonnet-4")
  })

  it("strips both provider prefix and date suffix", () => {
    expect(parseModelName("anthropic/claude-opus-4-20250514")).toBe("claude-opus-4")
  })

  it("lowercases result", () => {
    expect(parseModelName("Claude-Sonnet-4-20250514")).toBe("claude-sonnet-4")
  })

  it("passes through model string with no date suffix", () => {
    expect(parseModelName("claude-sonnet-4-6")).toBe("claude-sonnet-4-6")
  })

  it("passes through short model string with no date suffix", () => {
    expect(parseModelName("claude-opus-4")).toBe("claude-opus-4")
  })

  it("returns 'unknown' for null", () => {
    expect(parseModelName(null)).toBe("unknown")
  })

  it("returns 'unknown' for undefined", () => {
    expect(parseModelName(undefined)).toBe("unknown")
  })

  it("returns 'unknown' for empty string", () => {
    expect(parseModelName("")).toBe("unknown")
  })

  it("returns 'unknown' for whitespace-only string", () => {
    expect(parseModelName("   ")).toBe("unknown")
  })
})

describe("normalizeModelName", () => {
  it("is an alias for parseModelName", () => {
    expect(normalizeModelName("anthropic/claude-sonnet-4-20250514")).toBe(
      parseModelName("anthropic/claude-sonnet-4-20250514"),
    )
  })

  it("normalizes a dated model string to pricing key format", () => {
    expect(normalizeModelName("claude-sonnet-4-20250514")).toBe("claude-sonnet-4")
  })
})
