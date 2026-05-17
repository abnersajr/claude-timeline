import { describe, expect, it } from "vitest"
import {
  classifyMessage,
  classifyMessages,
  isCompactMessage,
  isHardNoise,
  isSystemMessage,
  isUserMessage,
} from "../src/classifier"
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

describe("classifier", () => {
  describe("isHardNoise", () => {
    it("returns true for system type", () => {
      expect(isHardNoise(makeRecord({ type: "system" }))).toBe(true)
    })

    it("returns true for summary type", () => {
      expect(isHardNoise(makeRecord({ type: "summary" }))).toBe(true)
    })

    it("returns true for file-history-snapshot type", () => {
      expect(isHardNoise(makeRecord({ type: "file-history-snapshot" }))).toBe(true)
    })

    it("returns true for queue-operation type", () => {
      expect(isHardNoise(makeRecord({ type: "queue-operation" }))).toBe(true)
    })

    it("returns true for attachment type", () => {
      expect(isHardNoise(makeRecord({ type: "attachment" }))).toBe(true)
    })

    it("returns true for last-prompt type", () => {
      expect(isHardNoise(makeRecord({ type: "last-prompt" }))).toBe(true)
    })

    it("returns true for permission-mode type", () => {
      expect(isHardNoise(makeRecord({ type: "permission-mode" }))).toBe(true)
    })

    it("returns true for sidechain messages", () => {
      expect(isHardNoise(makeRecord({ isSidechain: true }))).toBe(true)
    })

    it("returns true for synthetic assistant messages", () => {
      expect(
        isHardNoise(
          makeRecord({
            type: "assistant",
            message: { role: "assistant", content: [], model: "<synthetic>" },
          }),
        ),
      ).toBe(true)
    })

    it("returns true for user messages with hard noise tags", () => {
      expect(
        isHardNoise(
          makeRecord({
            type: "user",
            message: {
              role: "user",
              content: "<local-command-caveat>test</local-command-caveat>",
            },
          }),
        ),
      ).toBe(true)
    })

    it("returns true for user messages with system-reminder tags", () => {
      expect(
        isHardNoise(
          makeRecord({
            type: "user",
            message: {
              role: "user",
              content: "<system-reminder>reminder</system-reminder>",
            },
          }),
        ),
      ).toBe(true)
    })

    it("returns true for interruption messages", () => {
      expect(
        isHardNoise(
          makeRecord({
            type: "user",
            message: {
              role: "user",
              content: "[Request interrupted by user]",
            },
          }),
        ),
      ).toBe(true)
    })

    it("returns false for normal assistant message", () => {
      expect(isHardNoise(makeRecord())).toBe(false)
    })

    it("returns false for normal user message", () => {
      expect(
        isHardNoise(makeRecord({ type: "user", message: { role: "user", content: "hi" } })),
      ).toBe(false)
    })
  })

  describe("isCompactMessage", () => {
    it("returns true when isCompactSummary is true", () => {
      expect(isCompactMessage(makeRecord({ isCompactSummary: true }))).toBe(true)
    })

    it("returns false when isCompactSummary is absent", () => {
      expect(isCompactMessage(makeRecord())).toBe(false)
    })

    it("returns false when isCompactSummary is false", () => {
      expect(isCompactMessage(makeRecord({ isCompactSummary: false }))).toBe(false)
    })
  })

  describe("isSystemMessage", () => {
    it("returns true for user message starting with local-command-stdout", () => {
      expect(
        isSystemMessage(
          makeRecord({
            type: "user",
            message: {
              role: "user",
              content: "<local-command-stdout>output</local-command-stdout>",
            },
          }),
        ),
      ).toBe(true)
    })

    it("returns true for user message starting with local-command-stderr", () => {
      expect(
        isSystemMessage(
          makeRecord({
            type: "user",
            message: {
              role: "user",
              content: "<local-command-stderr>error</local-command-stderr>",
            },
          }),
        ),
      ).toBe(true)
    })

    it("returns false for regular user message", () => {
      expect(
        isSystemMessage(makeRecord({ type: "user", message: { role: "user", content: "hi" } })),
      ).toBe(false)
    })

    it("returns false for assistant message", () => {
      expect(isSystemMessage(makeRecord())).toBe(false)
    })
  })

  describe("isUserMessage", () => {
    it("returns true for user message with text content", () => {
      expect(
        isUserMessage(makeRecord({ type: "user", message: { role: "user", content: "hi" } })),
      ).toBe(true)
    })

    it("returns true for user message with image content", () => {
      expect(
        isUserMessage(
          makeRecord({
            type: "user",
            message: {
              role: "user",
              content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } }],
            },
          }),
        ),
      ).toBe(true)
    })

    it("returns false for meta messages (tool results)", () => {
      expect(
        isUserMessage(
          makeRecord({
            type: "user",
            isMeta: true,
            message: {
              role: "user",
              content: [{ type: "tool_result", tool_use_id: "1", content: "ok" }],
            },
          }),
        ),
      ).toBe(false)
    })

    it("returns false for user messages with only tool_result blocks (no text)", () => {
      expect(
        isUserMessage(
          makeRecord({
            type: "user",
            message: {
              role: "user",
              content: [{ type: "tool_result", tool_use_id: "1", content: "ok" }],
            },
          }),
        ),
      ).toBe(false)
    })

    it("returns false for assistant type", () => {
      expect(isUserMessage(makeRecord())).toBe(false)
    })
  })

  describe("classifyMessage", () => {
    it("classifies noise types as hardNoise", () => {
      expect(classifyMessage(makeRecord({ type: "system" }))).toBe("hardNoise")
      expect(classifyMessage(makeRecord({ type: "summary" }))).toBe("hardNoise")
      expect(classifyMessage(makeRecord({ type: "file-history-snapshot" }))).toBe("hardNoise")
      expect(classifyMessage(makeRecord({ type: "queue-operation" }))).toBe("hardNoise")
      expect(classifyMessage(makeRecord({ type: "attachment" }))).toBe("hardNoise")
      expect(classifyMessage(makeRecord({ type: "last-prompt" }))).toBe("hardNoise")
      expect(classifyMessage(makeRecord({ type: "permission-mode" }))).toBe("hardNoise")
    })

    it("classifies sidechain as hardNoise", () => {
      expect(classifyMessage(makeRecord({ isSidechain: true }))).toBe("hardNoise")
    })

    it("classifies compact messages", () => {
      expect(classifyMessage(makeRecord({ isCompactSummary: true }))).toBe("compact")
    })

    it("classifies command output as system", () => {
      expect(
        classifyMessage(
          makeRecord({
            type: "user",
            message: {
              role: "user",
              content: "<local-command-stdout>output</local-command-stdout>",
            },
          }),
        ),
      ).toBe("system")
    })

    it("classifies regular user messages", () => {
      expect(
        classifyMessage(makeRecord({ type: "user", message: { role: "user", content: "hi" } })),
      ).toBe("user")
    })

    it("classifies meta user messages (tool results) as assistant", () => {
      expect(
        classifyMessage(
          makeRecord({
            type: "user",
            isMeta: true,
            message: {
              role: "user",
              content: [{ type: "tool_result", tool_use_id: "1", content: "ok" }],
            },
          }),
        ),
      ).toBe("assistant")
    })

    it("classifies user messages with only tool_result as assistant", () => {
      expect(
        classifyMessage(
          makeRecord({
            type: "user",
            message: {
              role: "user",
              content: [{ type: "tool_result", tool_use_id: "1", content: "ok" }],
            },
          }),
        ),
      ).toBe("assistant")
    })

    it("classifies normal assistant messages", () => {
      expect(classifyMessage(makeRecord())).toBe("assistant")
    })
  })

  describe("classifyMessages", () => {
    it("classifies an array of messages", () => {
      const records = [
        makeRecord({ type: "user", message: { role: "user", content: "hi" } }),
        makeRecord({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } }),
        makeRecord({ type: "system" }),
        makeRecord({ isCompactSummary: true }),
      ]

      const result = classifyMessages(records)

      expect(result).toHaveLength(4)
      expect(result[0].category).toBe("user")
      expect(result[1].category).toBe("assistant")
      expect(result[2].category).toBe("hardNoise")
      expect(result[3].category).toBe("compact")
    })
  })
})
