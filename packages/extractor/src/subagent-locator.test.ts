import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  extractAgentId,
  hasSubagents,
  isCompactAgent,
  listSubagentFiles,
  subagentBelongsToSession,
} from "./subagent-locator"

describe("subagent-locator", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "subagent-locator-test-"))
  })

  afterEach(() => {
    // Cleanup handled by OS
  })

  describe("extractAgentId", () => {
    it("should extract agent ID from filename", () => {
      expect(extractAgentId("agent-abc123.jsonl")).toBe("abc123")
    })

    it("should return null for non-matching filename", () => {
      expect(extractAgentId("other-file.jsonl")).toBeNull()
    })

    it("should return null for path without agent prefix", () => {
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

    it("should return false for non-existent file", () => {
      expect(subagentBelongsToSession("/nonexistent/file.jsonl", "session-123")).toBe(false)
    })
  })

  describe("listSubagentFiles", () => {
    it("should return empty array for non-existent directory", () => {
      const result = listSubagentFiles("/nonexistent", "project", "session-1")
      expect(result).toEqual([])
    })

    it("should discover files in NEW nested structure", () => {
      const subagentsDir = join(tempDir, "my-project", "session-1", "subagents")
      mkdirSync(subagentsDir, { recursive: true })

      writeFileSync(join(subagentsDir, "agent-abc123.jsonl"), "{}\n")
      writeFileSync(join(subagentsDir, "agent-def456.jsonl"), "{}\n")
      writeFileSync(join(subagentsDir, "other-file.txt"), "not jsonl")

      const result = listSubagentFiles(tempDir, "my-project", "session-1")
      expect(result).toHaveLength(2)
      expect(result.every((f) => f.filePath.endsWith(".jsonl"))).toBe(true)
      expect(result.every((f) => f.isNewStructure)).toBe(true)
      expect(result.map((f) => f.agentId).sort()).toEqual(["abc123", "def456"])
    })

    it("should encode project name with slashes", () => {
      const subagentsDir = join(tempDir, "org-project-name", "session-1", "subagents")
      mkdirSync(subagentsDir, { recursive: true })

      writeFileSync(join(subagentsDir, "agent-abc.jsonl"), "{}\n")

      const result = listSubagentFiles(tempDir, "org/project-name", "session-1")
      expect(result).toHaveLength(1)
      expect(result[0].agentId).toBe("abc")
    })

    it("should discover files in legacy flat structure", () => {
      const projectDir = join(tempDir, "my-project")
      mkdirSync(projectDir, { recursive: true })

      writeFileSync(
        join(projectDir, "agent-legacy123.jsonl"),
        JSON.stringify({ sessionId: "session-1" }) + "\n",
      )

      const result = listSubagentFiles(tempDir, "my-project", "session-1")
      expect(result).toHaveLength(1)
      expect(result[0].agentId).toBe("legacy123")
      expect(result[0].isNewStructure).toBe(false)
    })

    it("should filter legacy files by sessionId", () => {
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

    it("should exclude compact agents from legacy structure", () => {
      const projectDir = join(tempDir, "my-project")
      mkdirSync(projectDir, { recursive: true })

      writeFileSync(
        join(projectDir, "agent-acompact-abc.jsonl"),
        JSON.stringify({ sessionId: "session-1" }) + "\n",
      )

      const result = listSubagentFiles(tempDir, "my-project", "session-1")
      expect(result).toHaveLength(0)
    })

    it("should return both NEW and legacy files", () => {
      const newDir = join(tempDir, "my-project", "session-1", "subagents")
      mkdirSync(newDir, { recursive: true })
      writeFileSync(join(newDir, "agent-new1.jsonl"), "{}\n")

      const projectDir = join(tempDir, "my-project")
      writeFileSync(
        join(projectDir, "agent-legacy1.jsonl"),
        JSON.stringify({ sessionId: "session-1" }) + "\n",
      )

      const result = listSubagentFiles(tempDir, "my-project", "session-1")
      expect(result).toHaveLength(2)
      expect(result.filter((f) => f.isNewStructure)).toHaveLength(1)
      expect(result.filter((f) => !f.isNewStructure)).toHaveLength(1)
    })
  })

  describe("hasSubagents", () => {
    it("should return false for non-existent directory", () => {
      const result = hasSubagents("/nonexistent", "project", "session-1")
      expect(result).toBe(false)
    })

    it("should return true when NEW structure has subagent files", () => {
      const subagentsDir = join(tempDir, "my-project", "session-1", "subagents")
      mkdirSync(subagentsDir, { recursive: true })
      writeFileSync(join(subagentsDir, "agent-abc.jsonl"), '{"type":"user"}\n')

      expect(hasSubagents(tempDir, "my-project", "session-1")).toBe(true)
    })

    it("should return true when legacy structure has matching subagent files", () => {
      const projectDir = join(tempDir, "my-project")
      mkdirSync(projectDir, { recursive: true })
      writeFileSync(
        join(projectDir, "agent-abc.jsonl"),
        JSON.stringify({ sessionId: "session-1" }) + "\n",
      )

      expect(hasSubagents(tempDir, "my-project", "session-1")).toBe(true)
    })

    it("should return false when no subagent files exist", () => {
      const projectDir = join(tempDir, "my-project")
      mkdirSync(projectDir, { recursive: true })
      writeFileSync(join(projectDir, "other-file.txt"), "not a subagent")

      expect(hasSubagents(tempDir, "my-project", "session-1")).toBe(false)
    })
  })
})
