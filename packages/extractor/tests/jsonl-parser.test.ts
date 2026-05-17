import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { parseSessionJsonl } from "../src/jsonl-parser"

describe("jsonl-parser", () => {
  let tmpDir: string
  let jsonlPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"))
    jsonlPath = path.join(tmpDir, "session-1.jsonl")
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true })
  })

  it("should parse valid JSONL with 2 records", () => {
    const content = [
      JSON.stringify({
        type: "assistant",
        uuid: "1",
        timestamp: "2026-05-07T19:22:45.118Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
        },
      }),
      JSON.stringify({
        type: "user",
        uuid: "2",
        timestamp: "2026-05-07T19:22:46.118Z",
        message: { role: "user", content: [{ type: "text", text: "Hi" }] },
      }),
    ].join("\n")
    fs.writeFileSync(jsonlPath, content)

    const result = parseSessionJsonl(jsonlPath, "session-1")
    expect(result).not.toBeNull()
    expect(result?.rawMessages.length).toBe(2)
    expect(result?.malformedCount).toBe(0)
  })

  it("should extract tool_use from assistant messages", () => {
    const content = JSON.stringify({
      type: "assistant",
      uuid: "1",
      timestamp: "2026-05-07T19:22:45.118Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "Bash",
            input: { command: "ls" },
            toolUseId: "tool-1",
          },
        ],
      },
    })
    fs.writeFileSync(jsonlPath, content)

    const result = parseSessionJsonl(jsonlPath, "session-1")
    expect(result).not.toBeNull()
    expect(result?.toolCalls.length).toBe(1)
    expect(result?.toolCalls[0].toolUseId).toBe("tool-1")
    expect(result?.toolCalls[0].name).toBe("Bash")
    expect(result?.toolCalls[0].input).toEqual({ command: "ls" })
  })

  it("should match toolUseResult to existing toolCall via parentUuid", () => {
    const content = [
      JSON.stringify({
        type: "assistant",
        uuid: "assistant-1",
        timestamp: "2026-05-07T19:22:45.118Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Bash",
              input: { command: "ls" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        uuid: "user-1",
        parentUuid: "assistant-1",
        timestamp: "2026-05-07T19:22:46.118Z",
        toolUseResult: {
          stdout: "file.txt",
          stderr: "",
          interrupted: false,
        },
        message: { role: "user", content: [] },
      }),
    ].join("\n")
    fs.writeFileSync(jsonlPath, content)

    const result = parseSessionJsonl(jsonlPath, "session-1")
    expect(result).not.toBeNull()
    expect(result?.toolCalls.length).toBe(1)
    expect(result?.toolCalls[0].result).toBe("file.txt")
    expect(result?.toolCalls[0].isError).toBe(false)
  })

  it("should skip malformed lines and increment count", () => {
    const content = [
      JSON.stringify({
        type: "assistant",
        uuid: "1",
        message: { content: [] },
      }),
      "not-json",
      JSON.stringify({
        type: "user",
        uuid: "2",
        message: { content: [] },
      }),
    ].join("\n")
    fs.writeFileSync(jsonlPath, content)

    const result = parseSessionJsonl(jsonlPath, "session-1")
    expect(result).not.toBeNull()
    expect(result?.rawMessages.length).toBe(2)
    expect(result?.malformedCount).toBe(1)
  })

  it("should return null for missing file", () => {
    const result = parseSessionJsonl("/non-existent.jsonl", "session-1")
    expect(result).toBeNull()
  })

  it("should return null when jsonlPath is null", () => {
    const result = parseSessionJsonl(null, "session-1")
    expect(result).toBeNull()
  })

  it("should return empty arrays for empty file", () => {
    fs.writeFileSync(jsonlPath, "")

    const result = parseSessionJsonl(jsonlPath, "session-1")
    expect(result).not.toBeNull()
    expect(result?.rawMessages.length).toBe(0)
    expect(result?.toolCalls.length).toBe(0)
    expect(result?.malformedCount).toBe(0)
  })

  it("should handle toolUseResult with error", () => {
    const content = [
      JSON.stringify({
        type: "assistant",
        uuid: "assistant-2",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-2",
              name: "Bash",
              input: { command: "bad" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        uuid: "user-2",
        parentUuid: "assistant-2",
        toolUseResult: {
          stdout: "",
          stderr: "command not found",
          interrupted: true,
        },
        message: { role: "user", content: [] },
      }),
    ].join("\n")
    fs.writeFileSync(jsonlPath, content)

    const result = parseSessionJsonl(jsonlPath, "session-1")
    expect(result).not.toBeNull()
    expect(result?.toolCalls[0].result).toContain("command not found")
    expect(result?.toolCalls[0].isError).toBe(true)
  })

  it("should extract cache_creation 5m/1h breakdown from message.usage", () => {
    const content = JSON.stringify({
      type: "assistant",
      uuid: "1",
      timestamp: "2026-05-07T19:22:45.118Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        usage: {
          input_tokens: 2,
          output_tokens: 323,
          cache_read_input_tokens: 12143,
          cache_creation_input_tokens: 12973,
          cache_creation: {
            ephemeral_5m_input_tokens: 0,
            ephemeral_1h_input_tokens: 12973,
          },
        },
      },
    })
    fs.writeFileSync(jsonlPath, content)

    const result = parseSessionJsonl(jsonlPath, "session-1")
    expect(result).not.toBeNull()
    expect(result?.rawMessages[0].message?.usage?.cacheCreation5mTokens).toBe(0)
    expect(result?.rawMessages[0].message?.usage?.cacheCreation1hTokens).toBe(12973)
  })

  it("should handle cache_creation with only 5m tokens", () => {
    const content = JSON.stringify({
      type: "assistant",
      uuid: "1",
      timestamp: "2026-05-07T19:22:45.118Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        usage: {
          cache_creation: {
            ephemeral_5m_input_tokens: 5000,
            ephemeral_1h_input_tokens: 0,
          },
        },
      },
    })
    fs.writeFileSync(jsonlPath, content)

    const result = parseSessionJsonl(jsonlPath, "session-1")
    expect(result).not.toBeNull()
    expect(result?.rawMessages[0].message?.usage?.cacheCreation5mTokens).toBe(5000)
    expect(result?.rawMessages[0].message?.usage?.cacheCreation1hTokens).toBe(0)
  })
})
