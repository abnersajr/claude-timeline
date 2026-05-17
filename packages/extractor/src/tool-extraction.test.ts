import { describe, expect, it } from "vitest"
import type { ToolResult } from "../src/tool-extraction"
import {
  extractToolCalls,
  extractToolResults,
  formatToolResult,
  linkToolResults,
} from "../src/tool-extraction"
import type { ToolCall } from "../src/types"

describe("tool-extraction", () => {
  describe("extractToolCalls", () => {
    it("extracts tool_use blocks from content array", () => {
      const content = [
        { type: "text", text: "Let me search..." },
        {
          type: "tool_use",
          id: "toolu_123",
          name: "Bash",
          input: { command: "ls -la" },
        },
        {
          type: "tool_use",
          id: "toolu_456",
          name: "Read",
          input: { file_path: "/tmp/test.txt" },
        },
      ]

      const calls = extractToolCalls(content, "2024-01-01T00:00:00Z")

      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({
        toolUseId: "toolu_123",
        name: "Bash",
        input: { command: "ls -la" },
        timestamp: "2024-01-01T00:00:00Z",
        isTask: false,
        taskDescription: undefined,
        taskSubagentType: undefined,
      })
      expect(calls[1]).toEqual({
        toolUseId: "toolu_456",
        name: "Read",
        input: { file_path: "/tmp/test.txt" },
        timestamp: "2024-01-01T00:00:00Z",
        isTask: false,
        taskDescription: undefined,
        taskSubagentType: undefined,
      })
    })

    it("returns empty array for string content", () => {
      expect(extractToolCalls("hello world")).toEqual([])
    })

    it("returns empty array when no tool_use blocks", () => {
      const content = [{ type: "text", text: "just text" }]
      expect(extractToolCalls(content)).toEqual([])
    })

    it("identifies Task tool and extracts description and subagent_type", () => {
      const content = [
        {
          type: "tool_use",
          id: "toolu_task_1",
          name: "Task",
          input: {
            description: "Research code patterns",
            subagent_type: "research",
            prompt: "Find all usages of...",
          },
        },
      ]

      const calls = extractToolCalls(content)

      expect(calls).toHaveLength(1)
      expect(calls[0].isTask).toBe(true)
      expect(calls[0].taskDescription).toBe("Research code patterns")
      expect(calls[0].taskSubagentType).toBe("research")
      expect(calls[0].name).toBe("Task")
    })

    it("handles tool_use id field (raw JSONL format)", () => {
      const content = [
        {
          type: "tool_use",
          id: "raw_id_123",
          name: "Grep",
          input: { pattern: "test" },
        },
      ]

      const calls = extractToolCalls(content)

      expect(calls).toHaveLength(1)
      expect(calls[0].toolUseId).toBe("raw_id_123")
    })

    it("handles toolUseId field (normalized format)", () => {
      const content = [
        {
          type: "tool_use",
          toolUseId: "normalized_id_456",
          name: "Grep",
          input: { pattern: "test" },
        },
      ]

      const calls = extractToolCalls(content)

      expect(calls).toHaveLength(1)
      expect(calls[0].toolUseId).toBe("normalized_id_456")
    })
  })

  describe("extractToolResults", () => {
    it("extracts tool_result blocks from content array", () => {
      const content = [
        {
          type: "tool_result",
          tool_use_id: "toolu_123",
          content: "file content here",
          is_error: false,
        },
        {
          type: "tool_result",
          tool_use_id: "toolu_456",
          content: { error: "not found" },
          is_error: true,
        },
      ]

      const results = extractToolResults(content)

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        toolUseId: "toolu_123",
        content: "file content here",
        isError: false,
      })
      expect(results[1]).toEqual({
        toolUseId: "toolu_456",
        content: { error: "not found" },
        isError: true,
      })
    })

    it("returns empty array for string content", () => {
      expect(extractToolResults("no tools here")).toEqual([])
    })

    it("returns empty array when no tool_result blocks", () => {
      const content = [{ type: "text", text: "just text" }]
      expect(extractToolResults(content)).toEqual([])
    })

    it("handles tool_use_id field (raw JSONL format)", () => {
      const content = [
        {
          type: "tool_result",
          tool_use_id: "raw_id_123",
          content: "result",
        },
      ]

      const results = extractToolResults(content)
      expect(results).toHaveLength(1)
      expect(results[0].toolUseId).toBe("raw_id_123")
    })

    it("handles toolUseId field (normalized format)", () => {
      const content = [
        {
          type: "tool_result",
          toolUseId: "normalized_id_456",
          content: "result",
        },
      ]

      const results = extractToolResults(content)
      expect(results).toHaveLength(1)
      expect(results[0].toolUseId).toBe("normalized_id_456")
    })
  })

  describe("linkToolResults", () => {
    it("links results to calls by toolUseId", () => {
      const calls: ToolCall[] = [
        {
          toolUseId: "toolu_123",
          name: "Bash",
          input: { command: "ls" },
          isTask: false,
        },
        {
          toolUseId: "toolu_456",
          name: "Read",
          input: { file_path: "/tmp/test.txt" },
          isTask: false,
        },
      ]

      const results: ToolResult[] = [
        { toolUseId: "toolu_123", content: "file1.txt\nfile2.txt", isError: false },
        { toolUseId: "toolu_456", content: "file contents", isError: false },
      ]

      const linked = linkToolResults(calls, results)

      expect(linked).toHaveLength(2)
      expect(linked[0].result).toBe("file1.txt\nfile2.txt")
      expect(linked[0].isError).toBe(false)
      expect(linked[1].result).toBe("file contents")
      expect(linked[1].isError).toBe(false)
    })

    it("returns calls unchanged when no results match", () => {
      const calls: ToolCall[] = [
        {
          toolUseId: "toolu_123",
          name: "Bash",
          input: { command: "ls" },
          isTask: false,
        },
      ]

      const results: ToolResult[] = [{ toolUseId: "toolu_999", content: "other", isError: false }]

      const linked = linkToolResults(calls, results)

      expect(linked).toHaveLength(1)
      expect(linked[0].result).toBeUndefined()
    })

    it("preserves task metadata when linking", () => {
      const calls: ToolCall[] = [
        {
          toolUseId: "toolu_task_1",
          name: "Task",
          input: { description: "test" },
          isTask: true,
          taskDescription: "test task",
          taskSubagentType: "research",
        },
      ]

      const results: ToolResult[] = [
        { toolUseId: "toolu_task_1", content: "task completed", isError: false },
      ]

      const linked = linkToolResults(calls, results)

      expect(linked[0].isTask).toBe(true)
      expect(linked[0].taskDescription).toBe("test task")
      expect(linked[0].taskSubagentType).toBe("research")
      expect(linked[0].result).toBe("task completed")
    })

    it("handles error results", () => {
      const calls: ToolCall[] = [
        {
          toolUseId: "toolu_123",
          name: "Bash",
          input: { command: "invalid" },
          isTask: false,
        },
      ]

      const results: ToolResult[] = [
        { toolUseId: "toolu_123", content: "command not found", isError: true },
      ]

      const linked = linkToolResults(calls, results)

      expect(linked[0].isError).toBe(true)
      expect(linked[0].result).toBe("command not found")
    })
  })

  describe("formatToolResult", () => {
    it("returns empty string for null/undefined", () => {
      expect(formatToolResult(null)).toBe("")
      expect(formatToolResult(undefined)).toBe("")
    })

    it("returns string content as-is", () => {
      expect(formatToolResult("hello")).toBe("hello")
    })

    it("formats stdout/stderr results", () => {
      const content = { stdout: "file1.txt\nfile2.txt", stderr: "" }
      expect(formatToolResult(content)).toBe("file1.txt\nfile2.txt")
    })

    it("formats stdout with stderr", () => {
      const content = { stdout: "output", stderr: "some warning" }
      expect(formatToolResult(content)).toBe("output\n[stderr]: some warning")
    })

    it("formats questions/answers results", () => {
      const content = { questions: ["What file?"], answers: ["test.txt"] }
      expect(formatToolResult(content)).toBe(
        JSON.stringify({ questions: ["What file?"], answers: ["test.txt"] }),
      )
    })

    it("formats generic JSON results", () => {
      const content = { key: "value", count: 42 }
      expect(formatToolResult(content)).toBe(JSON.stringify(content))
    })

    it("formats array results", () => {
      const content = ["file1", "file2"]
      expect(formatToolResult(content)).toBe(JSON.stringify(content))
    })

    it("formats number results", () => {
      expect(formatToolResult(42)).toBe("42")
    })

    it("formats boolean results", () => {
      expect(formatToolResult(true)).toBe("true")
    })
  })
})
