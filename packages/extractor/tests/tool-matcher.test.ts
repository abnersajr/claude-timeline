import { describe, expect, it } from "vitest"
import { collectToolCalls, matchToolCalls, buildToolResultMap } from "../src/tool-matcher"
import type { ToolCall } from "../src/types"

describe("tool-matcher", () => {
  const mockToolCalls: ToolCall[] = [
    {
      toolUseId: "toolu_01abc",
      name: "Bash",
      input: { command: "ls -la" },
      timestamp: "2026-05-07T19:22:45.118Z",
    },
    {
      toolUseId: "toolu_02def",
      name: "Read",
      input: { filePath: "/tmp/test.txt" },
      timestamp: "2026-05-07T19:22:46.200Z",
    },
    {
      toolUseId: "toolu_03ghi",
      name: "Bash",
      input: { command: "cat file.txt" },
      timestamp: "2026-05-07T19:22:47.300Z",
    },
  ]

  describe("matchToolCalls", () => {
    it("should match tool calls to results", () => {
      const toolResults = new Map([
        ["toolu_01abc", { result: "file1.txt\nfile2.txt", isError: false, timestamp: "2026-05-07T19:22:45.500Z" }],
        ["toolu_02def", { result: "Hello World", isError: false, timestamp: "2026-05-07T19:22:46.500Z" }],
      ])

      const executions = matchToolCalls(mockToolCalls, toolResults)

      expect(executions.length).toBe(3)
      expect(executions[0].toolCall.toolUseId).toBe("toolu_01abc")
      expect(executions[0].result).toBe("file1.txt\nfile2.txt")
      expect(executions[0].durationMs).toBeGreaterThan(0)
      expect(executions[1].toolCall.toolUseId).toBe("toolu_02def")
      expect(executions[1].result).toBe("Hello World")
      expect(executions[2].toolCall.toolUseId).toBe("toolu_03ghi")
      expect(executions[2].result).toBeUndefined()
    })

    it("should handle tool calls without results (pending)", () => {
      const toolResults = new Map<string, { result: string; isError: boolean; timestamp: string }>()

      const executions = matchToolCalls(mockToolCalls, toolResults)

      expect(executions.length).toBe(3)
      expect(executions[0].result).toBeUndefined()
      expect(executions[0].durationMs).toBe(0)
    })

    it("should handle error results", () => {
      const toolResults = new Map([
        ["toolu_01abc", { result: "Command failed", isError: true, timestamp: "2026-05-07T19:22:45.500Z" }],
      ])

      const executions = matchToolCalls(mockToolCalls, toolResults)

      expect(executions[0].isError).toBe(true)
      expect(executions[0].result).toBe("Command failed")
    })

    it("should sort by startTime", () => {
      const toolCalls: ToolCall[] = [
        { toolUseId: "toolu_b", name: "Bash", input: {}, timestamp: "2026-05-07T19:22:47.000Z" },
        { toolUseId: "toolu_a", name: "Bash", input: {}, timestamp: "2026-05-07T19:22:45.000Z" },
        { toolUseId: "toolu_c", name: "Bash", input: {}, timestamp: "2026-05-07T19:22:46.000Z" },
      ]

      const executions = matchToolCalls(toolCalls, new Map())

      expect(executions[0].toolCall.toolUseId).toBe("toolu_a")
      expect(executions[1].toolCall.toolUseId).toBe("toolu_c")
      expect(executions[2].toolCall.toolUseId).toBe("toolu_b")
    })

    it("should return empty array for empty input", () => {
      const executions = matchToolCalls([], new Map())
      expect(executions).toEqual([])
    })
  })

  describe("buildToolResultMap", () => {
    it("should build result map from raw messages", () => {
      const rawMessages = [
        {
          type: "user",
          uuid: "u1",
          parentUuid: "a1",
          toolUseResult: { toolUseId: "toolu_01abc", stdout: "file1.txt\nfile2.txt", stderr: "", interrupted: false },
          timestamp: "2026-05-07T19:22:45.500Z",
        },
        {
          type: "user",
          uuid: "u2",
          parentUuid: "a2",
          toolUseResult: { toolUseId: "toolu_02def", stdout: "Hello World", stderr: "", interrupted: false },
          timestamp: "2026-05-07T19:22:46.500Z",
        },
      ]

      const resultMap = buildToolResultMap(rawMessages)

      expect(resultMap.size).toBe(2)
      expect(resultMap.get("toolu_01abc")?.result).toBe("file1.txt\nfile2.txt")
      expect(resultMap.get("toolu_02def")?.result).toBe("Hello World")
    })

    it("should handle error results", () => {
      const rawMessages = [
        {
          type: "user",
          uuid: "u1",
          parentUuid: "a1",
          toolUseResult: { toolUseId: "toolu_01abc", stdout: "", stderr: "Command not found", interrupted: true },
          timestamp: "2026-05-07T19:22:45.500Z",
        },
      ]

      const resultMap = buildToolResultMap(rawMessages)

      expect(resultMap.get("toolu_01abc")?.isError).toBe(true)
    })

    it("should skip messages without toolUseResult", () => {
      const rawMessages = [
        {
          type: "user",
          uuid: "u1",
          parentUuid: "a1",
          message: { role: "user", content: "Hello" },
          timestamp: "2026-05-07T19:22:45.500Z",
        },
      ]

      const resultMap = buildToolResultMap(rawMessages)

      expect(resultMap.size).toBe(0)
    })

    it("should skip results without toolUseId", () => {
      const rawMessages = [
        {
          type: "user",
          uuid: "u1",
          parentUuid: "a1",
          toolUseResult: { stdout: "result" },
          timestamp: "2026-05-07T19:22:45.500Z",
        },
      ]

      const resultMap = buildToolResultMap(rawMessages)

      expect(resultMap.size).toBe(0)
    })
  })

  describe("collectToolCalls", () => {
    it("should collect tool calls from assistant messages", () => {
      const rawMessages = [
        {
          type: "assistant",
          uuid: "a1",
          timestamp: "2026-05-07T19:22:45.118Z",
          message: {
            role: "assistant",
            content: [
              { type: "tool_use", id: "toolu_01", name: "Bash", input: { command: "ls" } },
              { type: "tool_use", id: "toolu_02", name: "Read", input: { filePath: "/tmp/test.txt" } },
            ],
          },
        },
      ]

      const toolCalls = collectToolCalls(rawMessages)

      expect(toolCalls.length).toBe(2)
      expect(toolCalls[0].toolUseId).toBe("toolu_01")
      expect(toolCalls[0].name).toBe("Bash")
      expect(toolCalls[1].toolUseId).toBe("toolu_02")
      expect(toolCalls[1].name).toBe("Read")
    })

    it("should skip user messages", () => {
      const rawMessages = [
        {
          type: "user",
          uuid: "u1",
          message: { role: "user", content: "Hello" },
        },
      ]

      const toolCalls = collectToolCalls(rawMessages)

      expect(toolCalls.length).toBe(0)
    })

    it("should handle messages without content array", () => {
      const rawMessages = [
        {
          type: "assistant",
          uuid: "a1",
          message: { role: "assistant", content: "Hello" },
        },
      ]

      const toolCalls = collectToolCalls(rawMessages)

      expect(toolCalls.length).toBe(0)
    })
  })

  describe("matchToolCalls duration edge cases", () => {
    it("should handle invalid timestamps (NaN guard)", () => {
      const toolCalls: ToolCall[] = [
        { toolUseId: "toolu_01", name: "Bash", input: {}, timestamp: "invalid-date" },
      ]

      const toolResults = new Map([
        ["toolu_01", { result: "output", isError: false, timestamp: "2026-05-07T19:22:45.500Z" }],
      ])

      const executions = matchToolCalls(toolCalls, toolResults)

      expect(executions[0].durationMs).toBe(0)
      expect(Number.isNaN(executions[0].durationMs)).toBe(false)
    })
  })

  describe("buildToolResultMap toolUseId matching", () => {
    it("should key results by toolUseId from result metadata", () => {
      const rawMessages = [
        {
          type: "user",
          uuid: "u1",
          parentUuid: "a1",
          toolUseResult: { toolUseId: "toolu_01", stdout: "result", stderr: "", interrupted: false },
          timestamp: "2026-05-07T19:22:45.500Z",
        },
      ]

      const resultMap = buildToolResultMap(rawMessages)

      expect(resultMap.size).toBe(1)
      expect(resultMap.has("toolu_01")).toBe(true)
      expect(resultMap.get("toolu_01")?.result).toBe("result")
    })

    it("should skip results without toolUseId", () => {
      const rawMessages = [
        {
          type: "user",
          uuid: "u1",
          parentUuid: "a1",
          toolUseResult: { stdout: "result" },
          timestamp: "2026-05-07T19:22:45.500Z",
        },
      ]

      const resultMap = buildToolResultMap(rawMessages)

      expect(resultMap.size).toBe(0)
    })
  })
})
