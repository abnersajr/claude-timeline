import { describe, expect, it } from "vitest"
import { matchToolCalls, buildToolResultMap } from "../src/tool-matcher"
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
          toolUseResult: { stdout: "file1.txt\nfile2.txt", stderr: "", interrupted: false },
          timestamp: "2026-05-07T19:22:45.500Z",
        },
        {
          type: "user",
          uuid: "u2",
          parentUuid: "a2",
          toolUseResult: { stdout: "Hello World", stderr: "", interrupted: false },
          timestamp: "2026-05-07T19:22:46.500Z",
        },
      ]

      const resultMap = buildToolResultMap(rawMessages)

      expect(resultMap.size).toBe(2)
      expect(resultMap.get("a1")?.result).toBe("file1.txt\nfile2.txt")
      expect(resultMap.get("a2")?.result).toBe("Hello World")
    })

    it("should handle error results", () => {
      const rawMessages = [
        {
          type: "user",
          uuid: "u1",
          parentUuid: "a1",
          toolUseResult: { stdout: "", stderr: "Command not found", interrupted: true },
          timestamp: "2026-05-07T19:22:45.500Z",
        },
      ]

      const resultMap = buildToolResultMap(rawMessages)

      expect(resultMap.get("a1")?.isError).toBe(true)
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

    it("should skip messages without parentUuid", () => {
      const rawMessages = [
        {
          type: "user",
          uuid: "u1",
          toolUseResult: { stdout: "result" },
          timestamp: "2026-05-07T19:22:45.500Z",
        },
      ]

      const resultMap = buildToolResultMap(rawMessages)

      expect(resultMap.size).toBe(0)
    })
  })
})
