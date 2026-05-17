import { describe, expect, it } from "vitest"
import { detectSessionState } from "../src/session-state"
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

/** Helper to build a text output record (assistant with text) */
function textOutput(text = "done"): RawJsonlRecord {
  return makeRecord({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  })
}

/** Helper to build a thinking record */
function thinking(): RawJsonlRecord {
  return makeRecord({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "thinking", text: "let me think..." }],
    },
  })
}

/** Helper to build a tool_use record */
function toolUse(name = "Read"): RawJsonlRecord {
  return makeRecord({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", name, input: {}, toolUseId: "tu1" }],
    },
  })
}

/** Helper to build a tool_result record */
function toolResult(): RawJsonlRecord {
  return makeRecord({
    type: "user",
    isMeta: true,
    message: {
      role: "user",
      content: [{ type: "tool_result", toolUseId: "tu1", content: "ok" }],
    },
  })
}

/** Helper to build an interruption record */
function interruption(): RawJsonlRecord {
  return makeRecord({
    type: "user",
    message: {
      role: "user",
      content: "[Request interrupted by user]",
    },
  })
}

describe("session-state", () => {
  describe("detectSessionState", () => {
    it("returns false for empty records", () => {
      expect(detectSessionState([])).toEqual({ isOngoing: false })
    })

    it("returns false when session ends with text output", () => {
      // user → assistant(thinking) → assistant(text) → DONE
      const records = [
        makeRecord({
          type: "user",
          message: { role: "user", content: "do something" },
        }),
        thinking(),
        textOutput(),
      ]
      expect(detectSessionState(records)).toEqual({ isOngoing: false })
    })

    it("returns true when AI activities exist after last text output", () => {
      // user → assistant(text) → assistant(thinking) → assistant(tool_use)
      // Last ending event is text_output, but thinking + tool_use follow → ongoing
      const records = [
        makeRecord({
          type: "user",
          message: { role: "user", content: "do something" },
        }),
        textOutput(),
        thinking(),
        toolUse(),
      ]
      expect(detectSessionState(records)).toEqual({ isOngoing: true })
    })

    it("returns false when last event is interruption", () => {
      // user → assistant(text) → interruption → DONE
      // Even though text_output is an ending event, interruption is always the end
      const records = [
        makeRecord({
          type: "user",
          message: { role: "user", content: "do something" },
        }),
        textOutput(),
        interruption(),
      ]
      expect(detectSessionState(records)).toEqual({ isOngoing: false })
    })

    it("returns true when last event is tool_result after text output", () => {
      // user → assistant(text) → assistant(tool_use) → user(tool_result) → ongoing
      const records = [
        makeRecord({
          type: "user",
          message: { role: "user", content: "do something" },
        }),
        textOutput(),
        toolUse(),
        toolResult(),
      ]
      expect(detectSessionState(records)).toEqual({ isOngoing: true })
    })
  })
})
