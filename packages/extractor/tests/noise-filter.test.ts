import { describe, expect, it } from "vitest"
import { isDisplayableEntry } from "../src/noise-filter"

describe("noise-filter", () => {
  it("should filter out system entries", () => {
    expect(isDisplayableEntry({ type: "system", uuid: "1" })).toBe(false)
  })

  it("should filter out summary entries", () => {
    expect(isDisplayableEntry({ type: "summary", uuid: "1" })).toBe(false)
  })

  it("should filter out file-history-snapshot entries", () => {
    expect(isDisplayableEntry({ type: "file-history-snapshot", uuid: "1" })).toBe(false)
  })

  it("should filter out queue-operation entries", () => {
    expect(isDisplayableEntry({ type: "queue-operation", uuid: "1" })).toBe(false)
  })

  it("should filter out attachment entries", () => {
    expect(isDisplayableEntry({ type: "attachment", uuid: "1" })).toBe(false)
  })

  it("should filter out last-prompt entries", () => {
    expect(isDisplayableEntry({ type: "last-prompt", uuid: "1" })).toBe(false)
  })

  it("should filter out permission-mode entries", () => {
    expect(isDisplayableEntry({ type: "permission-mode", uuid: "1" })).toBe(false)
  })

  it("should filter out synthetic assistant messages", () => {
    expect(
      isDisplayableEntry({
        type: "assistant",
        uuid: "1",
        message: { model: "<synthetic>", content: [] },
      }),
    ).toBe(false)
  })

  it("should filter out sidechain messages", () => {
    expect(
      isDisplayableEntry({
        type: "assistant",
        uuid: "1",
        isSidechain: true,
        message: { content: [] },
      }),
    ).toBe(false)
  })

  it("should keep real assistant messages", () => {
    expect(
      isDisplayableEntry({
        type: "assistant",
        uuid: "1",
        message: { content: [{ type: "text", text: "Hello" }] },
      }),
    ).toBe(true)
  })

  it("should keep real user messages", () => {
    expect(
      isDisplayableEntry({
        type: "user",
        uuid: "1",
        message: { content: "Hello" },
      }),
    ).toBe(true)
  })

  it("should filter out hard noise tags", () => {
    expect(
      isDisplayableEntry({
        type: "user",
        uuid: "1",
        message: {
          content: "<local-command-caveat>test</local-command-caveat>",
        },
      }),
    ).toBe(false)
  })

  it("should filter out system-reminder tags", () => {
    expect(
      isDisplayableEntry({
        type: "user",
        uuid: "1",
        message: { content: "<system-reminder>reminder</system-reminder>" },
      }),
    ).toBe(false)
  })

  it("should keep command output", () => {
    expect(
      isDisplayableEntry({
        type: "user",
        uuid: "1",
        message: {
          content: "<local-command-stdout>output</local-command-stdout>",
        },
      }),
    ).toBe(true)
  })

  it("should keep meta user messages (tool results)", () => {
    expect(
      isDisplayableEntry({
        type: "user",
        uuid: "1",
        isMeta: true,
        message: {
          content: [{ type: "tool_result", tool_use_id: "1", content: "ok" }],
        },
      }),
    ).toBe(true)
  })

  it("should filter entries without uuid", () => {
    expect(isDisplayableEntry({ type: "assistant" })).toBe(false)
  })
})
