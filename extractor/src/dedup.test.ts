import { describe, expect, it } from "vitest"
import { deduplicateByRequestId } from "./dedup"
import type { RawJsonlRecord } from "./types"

/** Helper to build a minimal RawJsonlRecord with overrides */
function makeRecord(
  overrides: Partial<RawJsonlRecord>,
): RawJsonlRecord {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      usage: { output_tokens: 10 },
    },
    ...overrides,
  }
}

describe("deduplicateByRequestId", () => {
  it("keeps the entry with highest output_tokens per requestId", () => {
    const records: RawJsonlRecord[] = [
      makeRecord({
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [],
          usage: { output_tokens: 5 },
        },
      }),
      makeRecord({
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [],
          usage: { output_tokens: 20 },
        },
      }),
      makeRecord({
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [],
          usage: { output_tokens: 10 },
        },
      }),
    ]

    const result = deduplicateByRequestId(records)

    expect(result.length).toBe(1)
    expect(result[0].message?.usage?.output_tokens).toBe(20)
  })

  it("passes through entries without requestId unchanged", () => {
    const records: RawJsonlRecord[] = [
      makeRecord({
        type: "user",
        message: { role: "user", content: "hi" },
      }),
      makeRecord({
        type: "user",
        message: { role: "user", content: "hi again" },
      }),
    ]

    const result = deduplicateByRequestId(records)

    expect(result.length).toBe(2)
  })

  it("deduplicates assistant entries while keeping non-assistant entries", () => {
    const records: RawJsonlRecord[] = [
      makeRecord({
        type: "user",
        message: { role: "user", content: "hi" },
      }),
      makeRecord({
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [],
          usage: { output_tokens: 5 },
        },
      }),
      makeRecord({
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [],
          usage: { output_tokens: 30 },
        },
      }),
      makeRecord({
        requestId: "req-2",
        message: {
          role: "assistant",
          content: [],
          usage: { output_tokens: 15 },
        },
      }),
    ]

    const result = deduplicateByRequestId(records)

    // user + deduped req-1 + req-2 = 3
    expect(result.length).toBe(3)
    expect(result[0].type).toBe("user")
    expect(result[1].message?.usage?.output_tokens).toBe(30)
    expect(result[2].message?.usage?.output_tokens).toBe(15)
  })

  it("passes through all entries when none have requestId", () => {
    const records: RawJsonlRecord[] = [
      makeRecord({
        type: "user",
        message: { role: "user", content: "hi" },
      }),
      makeRecord({
        type: "assistant",
        message: {
          role: "assistant",
          content: [],
          usage: { output_tokens: 100 },
        },
      }),
    ]

    const result = deduplicateByRequestId(records)

    expect(result.length).toBe(2)
  })
})
