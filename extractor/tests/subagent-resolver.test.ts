import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  extractAgentId,
  isCompactAgent,
  listSubagentFiles,
  subagentBelongsToSession,
} from "../src/subagent-locator"
import { isWarmupAgent, parseSubagentFile, resolveSubagents } from "../src/subagent-resolver"
import type { RawJsonlRecord } from "../src/types"

describe("subagent-resolver", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "subagent-test-"))
  })

  afterEach(() => {
    // Cleanup handled by OS
  })

  describe("extractAgentId", () => {
    it("should extract agent ID from file path", () => {
      expect(extractAgentId("/path/to/agent-abc123.jsonl")).toBe("abc123")
    })

    it("should return null for non-matching path", () => {
      expect(extractAgentId("/path/to/other.jsonl")).toBeNull()
    })

    it("should handle nested paths", () => {
      expect(extractAgentId("/a/b/c/agent-xyz789.jsonl")).toBe("xyz789")
    })
  })

  describe("isCompactAgent", () => {
    it("should return true for acompact prefix", () => {
      expect(isCompactAgent("acompact-abc")).toBe(true)
    })

    it("should return true for exact acompact", () => {
      expect(isCompactAgent("acompact")).toBe(true)
    })

    it("should return false for normal agent", () => {
      expect(isCompactAgent("abc123")).toBe(false)
    })

    it("should return false for agent starting with a", () => {
      expect(isCompactAgent("abc")).toBe(false)
    })
  })

  describe("isWarmupAgent", () => {
    it("should return true for warmup agent", () => {
      const records: RawJsonlRecord[] = [
        {
          type: "user",
          message: { role: "user", content: "Warmup" },
        },
      ]
      expect(isWarmupAgent(records)).toBe(true)
    })

    it("should return false for normal agent", () => {
      const records: RawJsonlRecord[] = [
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
      const records: RawJsonlRecord[] = [
        {
          type: "user",
          message: { role: "user", content: [{ type: "text", text: "Warmup" }] },
        },
      ]
      expect(isWarmupAgent(records)).toBe(false)
    })
  })

  describe("listSubagentFiles (legacy flat structure)", () => {
    it("should return empty array for non-existent directory", () => {
      const result = listSubagentFiles("/nonexistent", "project", "session-1")
      expect(result).toEqual([])
    })

    it("should discover agent JSONL files in legacy structure", () => {
      const projectDir = join(tempDir, "my-project")
      mkdirSync(projectDir, { recursive: true })

      writeFileSync(
        join(projectDir, "agent-abc123.jsonl"),
        JSON.stringify({ sessionId: "session-1" }) + "\n",
      )
      writeFileSync(
        join(projectDir, "agent-def456.jsonl"),
        JSON.stringify({ sessionId: "session-1" }) + "\n",
      )
      writeFileSync(join(projectDir, "other-file.txt"), "not jsonl")

      const result = listSubagentFiles(tempDir, "my-project", "session-1")
      expect(result).toHaveLength(2)
      expect(result.every((f) => f.filePath.endsWith(".jsonl"))).toBe(true)
      expect(result.every((f) => f.filePath.includes("agent-"))).toBe(true)
    })

    it("should encode project name with slashes", () => {
      const projectDir = join(tempDir, "org-project-name")
      mkdirSync(projectDir, { recursive: true })

      writeFileSync(
        join(projectDir, "agent-abc.jsonl"),
        JSON.stringify({ sessionId: "session-1" }) + "\n",
      )

      const result = listSubagentFiles(tempDir, "org/project-name", "session-1")
      expect(result).toHaveLength(1)
    })

    it("should filter by sessionId in legacy structure", () => {
      const projectDir = join(tempDir, "my-project")
      mkdirSync(projectDir, { recursive: true })

      writeFileSync(
        join(projectDir, "agent-matching.jsonl"),
        JSON.stringify({ sessionId: "session-1" }) + "\n",
      )
      writeFileSync(
        join(projectDir, "agent-notmatching.jsonl"),
        JSON.stringify({ sessionId: "session-2" }) + "\n",
      )

      const result = listSubagentFiles(tempDir, "my-project", "session-1")
      expect(result).toHaveLength(1)
      expect(result[0].agentId).toBe("matching")
    })
  })

  describe("subagentBelongsToSession", () => {
    it("should return true when sessionId matches", () => {
      const filePath = join(tempDir, "agent-test.jsonl")
      writeFileSync(filePath, JSON.stringify({ sessionId: "session-123" }) + "\n")
      expect(subagentBelongsToSession(filePath, "session-123")).toBe(true)
    })

    it("should return false when sessionId does not match", () => {
      const filePath = join(tempDir, "agent-test.jsonl")
      writeFileSync(filePath, JSON.stringify({ sessionId: "other-session" }) + "\n")
      expect(subagentBelongsToSession(filePath, "session-123")).toBe(false)
    })

    it("should return false for empty file", () => {
      const filePath = join(tempDir, "agent-empty.jsonl")
      writeFileSync(filePath, "")
      expect(subagentBelongsToSession(filePath, "session-123")).toBe(false)
    })

    it("should return false for malformed JSON", () => {
      const filePath = join(tempDir, "agent-malformed.jsonl")
      writeFileSync(filePath, "not json\n")
      expect(subagentBelongsToSession(filePath, "session-123")).toBe(false)
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

    it("should handle empty file", () => {
      const filePath = join(tempDir, "agent-empty.jsonl")
      writeFileSync(filePath, "")

      const result = parseSubagentFile(filePath)
      expect(result).toBeNull()
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

      const parentToolCalls = [
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

    it("should extract description from first assistant text block", () => {
      const agentFile = join(tempDir, "agent-desc.jsonl")
      writeFileSync(
        agentFile,
        `${[
          {
            type: "user",
            timestamp: "2026-05-07T19:22:45.000Z",
            message: { role: "user", content: "Task" },
          },
          {
            type: "assistant",
            timestamp: "2026-05-07T19:22:46.000Z",
            message: {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "This is a long description that should be truncated at 200 characters",
                },
              ],
            },
          },
        ]
          .map((r) => JSON.stringify(r))
          .join("\n")}\n`,
      )

      const subagentFiles = [
        { filePath: agentFile, agentId: "desc", isNewStructure: true },
      ]

      const result = resolveSubagents(subagentFiles, [])
      expect(result).toHaveLength(1)
      expect(result[0].description).toBe(
        "This is a long description that should be truncated at 200 characters",
      )
    })

    it("should skip files with no matching agent ID in Task result", () => {
      const agentFile = join(tempDir, "agent-nomatch.jsonl")
      writeFileSync(
        agentFile,
        '{"type":"user","timestamp":"2026-05-07T19:22:45.000Z","message":{"role":"user","content":"test"}}\n',
      )

      const parentToolCalls = [
        {
          toolUseId: "tc1",
          name: "Task",
          input: {},
          result: JSON.stringify({ agentId: "different-id" }),
          isTask: true,
          taskDescription: "test",
        },
      ]

      const subagentFiles = [
        { filePath: agentFile, agentId: "nomatch", isNewStructure: true },
      ]

      const result = resolveSubagents(subagentFiles, parentToolCalls)
      expect(result).toHaveLength(1)
      // No agentId match, no description match, positional fallback assigns tc1
      expect(result[0].parentTaskId).toBe("tc1")
    })
  })
})
