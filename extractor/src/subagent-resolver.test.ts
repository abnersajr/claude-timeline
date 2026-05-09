import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  isWarmupAgent,
  parseSubagentFile,
  resolveSubagents,
} from "./subagent-resolver"
import type { ToolCall } from "./types"

describe("subagent-resolver", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "subagent-resolver-test-"))
  })

  afterEach(() => {
    // Cleanup handled by OS
  })

  describe("isWarmupAgent", () => {
    it("should return true for warmup agent", () => {
      const records = [
        {
          type: "user",
          message: { role: "user", content: "Warmup" },
        },
      ]
      expect(isWarmupAgent(records)).toBe(true)
    })

    it("should return false for normal agent", () => {
      const records = [
        {
          type: "user",
          message: { role: "user", content: "Hello" },
        },
      ]
      expect(isWarmupAgent(records)).toBe(false)
    })

    it("should return false for empty records", () => {
      expect(isWarmupAgent([])).toBe(false)
    })

    it("should return false when first user message is array content", () => {
      const records = [
        {
          type: "user",
          message: { role: "user", content: [{ type: "text", text: "Warmup" }] },
        },
      ]
      expect(isWarmupAgent(records)).toBe(false)
    })
  })

  describe("parseSubagentFile", () => {
    it("should return null for non-existent file", () => {
      expect(parseSubagentFile("/nonexistent/file.jsonl")).toBeNull()
    })

    it("should parse valid JSONL", () => {
      const filePath = join(tempDir, "agent-test.jsonl")
      const records = [
        {
          type: "user",
          timestamp: "2026-05-07T19:22:45.000Z",
          message: { role: "user", content: "Hello" },
        },
        {
          type: "assistant",
          timestamp: "2026-05-07T19:22:46.000Z",
          message: { role: "assistant", content: [{ type: "text", text: "Hi there" }] },
        },
      ]
      writeFileSync(filePath, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`)

      const result = parseSubagentFile(filePath)
      expect(result).not.toBeNull()
      expect(result!.records).toHaveLength(2)
      expect(result!.messages).toHaveLength(2)
    })

    it("should skip malformed lines", () => {
      const filePath = join(tempDir, "agent-malformed.jsonl")
      writeFileSync(filePath, '{"type":"user"}\nnot json\n{"type":"assistant"}\n')

      const result = parseSubagentFile(filePath)
      expect(result).not.toBeNull()
      expect(result!.records).toHaveLength(2)
    })

    it("should return null for empty file", () => {
      const filePath = join(tempDir, "agent-empty.jsonl")
      writeFileSync(filePath, "")

      const result = parseSubagentFile(filePath)
      expect(result).toBeNull()
    })

    it("should extract model from first assistant message", () => {
      const filePath = join(tempDir, "agent-model.jsonl")
      writeFileSync(
        filePath,
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-05-07T19:22:45.000Z",
          message: { role: "assistant", model: "claude-sonnet-4-6", content: [] },
        }) + "\n",
      )

      const result = parseSubagentFile(filePath)
      expect(result).not.toBeNull()
      expect(result!.model).toBe("claude-sonnet-4-6")
    })

    it("should extract description from first assistant text block", () => {
      const filePath = join(tempDir, "agent-desc.jsonl")
      writeFileSync(
        filePath,
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-05-07T19:22:45.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "This is a description" }],
          },
        }) + "\n",
      )

      const result = parseSubagentFile(filePath)
      expect(result).not.toBeNull()
    })

    it("should aggregate tokens with request-id dedup", () => {
      const filePath = join(tempDir, "agent-tokens.jsonl")
      // Two entries with same requestId — only last should count
      writeFileSync(
        filePath,
        [
          JSON.stringify({
            type: "assistant",
            requestId: "req-1",
            timestamp: "2026-05-07T19:22:45.000Z",
            message: {
              role: "assistant",
              content: [],
              usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50 },
            },
          }),
          JSON.stringify({
            type: "assistant",
            requestId: "req-1",
            timestamp: "2026-05-07T19:22:46.000Z",
            message: {
              role: "assistant",
              content: [],
              usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50 },
            },
          }),
        ].join("\n") + "\n",
      )

      const result = parseSubagentFile(filePath)
      expect(result).not.toBeNull()
      expect(result!.totalTokens.inputTokens).toBe(100)
      expect(result!.totalTokens.outputTokens).toBe(20) // last entry wins
      expect(result!.totalTokens.cacheReadTokens).toBe(50)
    })
  })

  describe("resolveSubagents", () => {
    it("should resolve subagents from files", () => {
      const agentFile = join(tempDir, "agent-abc123.jsonl")
      const records = [
        {
          type: "user",
          timestamp: "2026-05-07T19:22:45.000Z",
          message: { role: "user", content: "Do something" },
        },
        {
          type: "assistant",
          timestamp: "2026-05-07T19:22:46.000Z",
          message: { role: "assistant", content: [{ type: "text", text: "I will do it" }] },
        },
      ]
      writeFileSync(agentFile, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`)

      const parentToolCalls: ToolCall[] = [
        {
          toolUseId: "tc1",
          name: "Task",
          input: {},
          result: JSON.stringify({ agentId: "abc123" }),
          isTask: true,
          taskDescription: "Do something",
        },
      ]

      const subagentFiles = [
        { filePath: agentFile, agentId: "abc123", isNewStructure: true },
      ]

      const result = resolveSubagents(subagentFiles, parentToolCalls)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe("abc123")
      expect(result[0].parentTaskId).toBe("tc1")
      expect(result[0].turnCount).toBe(1)
      expect(result[0].status).toBe("completed")
    })

    it("should skip warmup agents", () => {
      const agentFile = join(tempDir, "agent-warmup123.jsonl")
      const records = [
        {
          type: "user",
          timestamp: "2026-05-07T19:22:45.000Z",
          message: { role: "user", content: "Warmup" },
        },
      ]
      writeFileSync(agentFile, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`)

      const subagentFiles = [
        { filePath: agentFile, agentId: "warmup123", isNewStructure: true },
      ]

      const result = resolveSubagents(subagentFiles, [])
      expect(result).toHaveLength(0)
    })

    it("should skip compact agents", () => {
      const agentFile = join(tempDir, "agent-acompact-abc.jsonl")
      writeFileSync(
        agentFile,
        '{"type":"user","timestamp":"2026-05-07T19:22:45.000Z","message":{"role":"user","content":"test"}}\n',
      )

      const subagentFiles = [
        { filePath: agentFile, agentId: "acompact-abc", isNewStructure: true },
      ]

      const result = resolveSubagents(subagentFiles, [])
      expect(result).toHaveLength(0)
    })

    it("should detect parallel execution", () => {
      const agent1 = join(tempDir, "agent-aaa.jsonl")
      const agent2 = join(tempDir, "agent-bbb.jsonl")

      writeFileSync(
        agent1,
        `${[
          {
            type: "user",
            timestamp: "2026-05-07T19:22:45.000Z",
            message: { role: "user", content: "Task 1" },
          },
          {
            type: "assistant",
            timestamp: "2026-05-07T19:22:50.000Z",
            message: { role: "assistant", content: [{ type: "text", text: "Done 1" }] },
          },
        ]
          .map((r) => JSON.stringify(r))
          .join("\n")}\n`,
      )

      writeFileSync(
        agent2,
        `${[
          {
            type: "user",
            timestamp: "2026-05-07T19:22:47.000Z",
            message: { role: "user", content: "Task 2" },
          },
          {
            type: "assistant",
            timestamp: "2026-05-07T19:22:52.000Z",
            message: { role: "assistant", content: [{ type: "text", text: "Done 2" }] },
          },
        ]
          .map((r) => JSON.stringify(r))
          .join("\n")}\n`,
      )

      const subagentFiles = [
        { filePath: agent1, agentId: "aaa", isNewStructure: true },
        { filePath: agent2, agentId: "bbb", isNewStructure: true },
      ]

      const result = resolveSubagents(subagentFiles, [])
      expect(result).toHaveLength(2)
      expect(result[0].isParallel).toBe(true)
      expect(result[1].isParallel).toBe(true)
    })

    it("should not mark non-overlapping subagents as parallel", () => {
      const agent1 = join(tempDir, "agent-ccc.jsonl")
      const agent2 = join(tempDir, "agent-ddd.jsonl")

      writeFileSync(
        agent1,
        `${[
          {
            type: "user",
            timestamp: "2026-05-07T19:22:45.000Z",
            message: { role: "user", content: "Task 1" },
          },
          {
            type: "assistant",
            timestamp: "2026-05-07T19:22:46.000Z",
            message: { role: "assistant", content: [{ type: "text", text: "Done 1" }] },
          },
        ]
          .map((r) => JSON.stringify(r))
          .join("\n")}\n`,
      )

      writeFileSync(
        agent2,
        `${[
          {
            type: "user",
            timestamp: "2026-05-07T19:22:50.000Z",
            message: { role: "user", content: "Task 2" },
          },
          {
            type: "assistant",
            timestamp: "2026-05-07T19:22:51.000Z",
            message: { role: "assistant", content: [{ type: "text", text: "Done 2" }] },
          },
        ]
          .map((r) => JSON.stringify(r))
          .join("\n")}\n`,
      )

      const subagentFiles = [
        { filePath: agent1, agentId: "ccc", isNewStructure: true },
        { filePath: agent2, agentId: "ddd", isNewStructure: true },
      ]

      const result = resolveSubagents(subagentFiles, [])
      expect(result).toHaveLength(2)
      expect(result[0].isParallel).toBe(false)
      expect(result[1].isParallel).toBe(false)
    })

    it("should sort by startTime", () => {
      const agent1 = join(tempDir, "agent-late.jsonl")
      const agent2 = join(tempDir, "agent-early.jsonl")

      writeFileSync(
        agent1,
        `${[
          {
            type: "user",
            timestamp: "2026-05-07T19:22:50.000Z",
            message: { role: "user", content: "Late" },
          },
          {
            type: "assistant",
            timestamp: "2026-05-07T19:22:51.000Z",
            message: { role: "assistant", content: [{ type: "text", text: "Done late" }] },
          },
        ]
          .map((r) => JSON.stringify(r))
          .join("\n")}\n`,
      )

      writeFileSync(
        agent2,
        `${[
          {
            type: "user",
            timestamp: "2026-05-07T19:22:45.000Z",
            message: { role: "user", content: "Early" },
          },
          {
            type: "assistant",
            timestamp: "2026-05-07T19:22:46.000Z",
            message: { role: "assistant", content: [{ type: "text", text: "Done early" }] },
          },
        ]
          .map((r) => JSON.stringify(r))
          .join("\n")}\n`,
      )

      const subagentFiles = [
        { filePath: agent1, agentId: "late", isNewStructure: true },
        { filePath: agent2, agentId: "early", isNewStructure: true },
      ]

      const result = resolveSubagents(subagentFiles, [])
      expect(result[0].id).toBe("early")
      expect(result[1].id).toBe("late")
    })

    it("should link by agentId from Task tool result", () => {
      const agentFile = join(tempDir, "agent-link1.jsonl")
      writeFileSync(
        agentFile,
        JSON.stringify({
          type: "user",
          timestamp: "2026-05-07T19:22:45.000Z",
          message: { role: "user", content: "Work" },
        }) + "\n",
      )

      const parentToolCalls: ToolCall[] = [
        {
          toolUseId: "tc-1",
          name: "Task",
          input: {},
          result: JSON.stringify({ agentId: "link1" }),
          isTask: true,
          taskDescription: "Do work",
        },
      ]

      const subagentFiles = [
        { filePath: agentFile, agentId: "link1", isNewStructure: true },
      ]

      const result = resolveSubagents(subagentFiles, parentToolCalls)
      expect(result).toHaveLength(1)
      expect(result[0].parentTaskId).toBe("tc-1")
    })

    it("should link by description when agentId match fails", () => {
      const agentFile = join(tempDir, "agent-desc-match.jsonl")
      writeFileSync(
        agentFile,
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-05-07T19:22:45.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Building the parser module" }],
          },
        }) + "\n",
      )

      const parentToolCalls: ToolCall[] = [
        {
          toolUseId: "tc-2",
          name: "Task",
          input: {},
          result: undefined, // No agentId in result
          isTask: true,
          taskDescription: "Build the parser module",
        },
      ]

      const subagentFiles = [
        { filePath: agentFile, agentId: "desc-match", isNewStructure: true },
      ]

      const result = resolveSubagents(subagentFiles, parentToolCalls)
      expect(result).toHaveLength(1)
      expect(result[0].parentTaskId).toBe("tc-2")
    })

    it("should use positional fallback for unmatched Task calls", () => {
      const agentFile = join(tempDir, "agent-pos.jsonl")
      writeFileSync(
        agentFile,
        JSON.stringify({
          type: "user",
          timestamp: "2026-05-07T19:22:45.000Z",
          message: { role: "user", content: "Task" },
        }) + "\n",
      )

      const parentToolCalls: ToolCall[] = [
        {
          toolUseId: "tc-pos",
          name: "Task",
          input: {},
          isTask: true,
          taskDescription: "Unmatched task",
        },
      ]

      const subagentFiles = [
        { filePath: agentFile, agentId: "pos", isNewStructure: true },
      ]

      const result = resolveSubagents(subagentFiles, parentToolCalls)
      expect(result).toHaveLength(1)
      expect(result[0].parentTaskId).toBe("tc-pos")
    })

    it("should aggregate tokens across records", () => {
      const agentFile = join(tempDir, "agent-tokens2.jsonl")
      writeFileSync(
        agentFile,
        [
          JSON.stringify({
            type: "assistant",
            requestId: "req-a",
            timestamp: "2026-05-07T19:22:45.000Z",
            message: {
              role: "assistant",
              content: [],
              usage: { input_tokens: 50, output_tokens: 5 },
            },
          }),
          JSON.stringify({
            type: "assistant",
            requestId: "req-a",
            timestamp: "2026-05-07T19:22:46.000Z",
            message: {
              role: "assistant",
              content: [],
              usage: { input_tokens: 50, output_tokens: 10 },
            },
          }),
          JSON.stringify({
            type: "assistant",
            requestId: "req-b",
            timestamp: "2026-05-07T19:22:47.000Z",
            message: {
              role: "assistant",
              content: [],
              usage: { input_tokens: 75, output_tokens: 15 },
            },
          }),
        ].join("\n") + "\n",
      )

      const subagentFiles = [
        { filePath: agentFile, agentId: "tokens2", isNewStructure: true },
      ]

      const result = resolveSubagents(subagentFiles, [])
      expect(result).toHaveLength(1)
      // req-a: 50 input, 10 output (last wins); req-b: 75 input, 15 output
      expect(result[0].totalTokens?.inputTokens).toBe(125)
      expect(result[0].totalTokens?.outputTokens).toBe(25)
    })

    it("should detect model from subagent records", () => {
      const agentFile = join(tempDir, "agent-model2.jsonl")
      writeFileSync(
        agentFile,
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-05-07T19:22:45.000Z",
          message: {
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [],
          },
        }) + "\n",
      )

      const subagentFiles = [
        { filePath: agentFile, agentId: "model2", isNewStructure: true },
      ]

      const result = resolveSubagents(subagentFiles, [])
      expect(result).toHaveLength(1)
      expect(result[0].model).toBe("claude-sonnet-4-6")
    })

    it("should populate messages and toolCalls on subagent", () => {
      const agentFile = join(tempDir, "agent-enriched.jsonl")
      writeFileSync(
        agentFile,
        [
          JSON.stringify({
            type: "user",
            timestamp: "2026-05-07T19:22:45.000Z",
            message: { role: "user", content: "Hello" },
          }),
          JSON.stringify({
            type: "assistant",
            timestamp: "2026-05-07T19:22:46.000Z",
            message: {
              role: "assistant",
              content: [
                { type: "text", text: "Hi" },
                {
                  type: "tool_use",
                  id: "tu-1",
                  name: "Bash",
                  input: { command: "echo hello" },
                },
              ],
            },
          }),
        ].join("\n") + "\n",
      )

      const subagentFiles = [
        { filePath: agentFile, agentId: "enriched", isNewStructure: true },
      ]

      const result = resolveSubagents(subagentFiles, [])
      expect(result).toHaveLength(1)
      expect(result[0].messages).toHaveLength(2)
      expect(result[0].toolCalls).toHaveLength(1)
      expect(result[0].toolCalls![0].name).toBe("Bash")
    })
  })
})
