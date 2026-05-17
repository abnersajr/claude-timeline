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

  it("merges equal-token content blocks from same requestId", () => {
    const records: RawJsonlRecord[] = [
      makeRecord({
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "reasoning..." }],
          usage: { output_tokens: 100 },
        },
      }),
      makeRecord({
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "here is the answer" }],
          usage: { output_tokens: 100 },
        },
      }),
      makeRecord({
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "tu-1", name: "bash", input: {} }],
          usage: { output_tokens: 100 },
        },
      }),
    ]

    const result = deduplicateByRequestId(records)

    // Should merge into 1 record with all content blocks
    expect(result.length).toBe(1)
    expect(result[0].message?.usage?.output_tokens).toBe(100)
    const content = result[0].message?.content as Array<Record<string, unknown>>
    expect(content.length).toBe(3)
    expect(content[0].type).toBe("thinking")
    expect(content[1].type).toBe("text")
    expect(content[2].type).toBe("tool_use")
  })

  it("merges multiple tool_use blocks with equal tokens", () => {
    const records: RawJsonlRecord[] = [
      makeRecord({
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "..." }],
          usage: { output_tokens: 429 },
        },
      }),
      makeRecord({
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "let me search" }],
          usage: { output_tokens: 429 },
        },
      }),
      makeRecord({
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "tu-1", name: "grep", input: {} }],
          usage: { output_tokens: 429 },
        },
      }),
      makeRecord({
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "tu-2", name: "grep", input: {} }],
          usage: { output_tokens: 429 },
        },
      }),
    ]

    const result = deduplicateByRequestId(records)

    expect(result.length).toBe(1)
    const content = result[0].message?.content as Array<Record<string, unknown>>
    expect(content.length).toBe(4)
    expect(content[0].type).toBe("thinking")
    expect(content[1].type).toBe("text")
    expect(content[2].type).toBe("tool_use")
    expect(content[3].type).toBe("tool_use")
  })

  it("handles mix of streaming and content-block duplicates", () => {
    const records: RawJsonlRecord[] = [
      // User message (no requestId)
      makeRecord({
        type: "user",
        message: { role: "user", content: "hi" },
      }),
      // Streaming: tokens increase
      makeRecord({
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "..." }],
          usage: { output_tokens: 50 },
        },
      }),
      makeRecord({
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "..." }],
          usage: { output_tokens: 100 },
        },
      }),
      // Content blocks: equal tokens
      makeRecord({
        requestId: "req-2",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "..." }],
          usage: { output_tokens: 200 },
        },
      }),
      makeRecord({
        requestId: "req-2",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "answer" }],
          usage: { output_tokens: 200 },
        },
      }),
    ]

    const result = deduplicateByRequestId(records)

    // user + deduped req-1 (streaming) + merged req-2 (content blocks) = 3
    expect(result.length).toBe(3)
    expect(result[0].type).toBe("user")
    expect(result[1].message?.usage?.output_tokens).toBe(100)
    expect(result[2].message?.usage?.output_tokens).toBe(200)
    const content = result[2].message?.content as Array<Record<string, unknown>>
    expect(content.length).toBe(2)
  })
})
