import { describe, expect, it } from "vitest"
import { buildConversationGroups } from "../src/conversation-groups"
import type { Turn, ToolCall, Message } from "../src/types"

/** Create a minimal Turn with user messages. */
function userTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    timestamp: "2024-01-01T00:00:00Z",
    tokenUsage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0 },
    messages: [{ type: "user" as const, content: [{ type: "text" as const, text: "hello" }] }],
    toolCalls: [],
    cacheWriteType: "none" as const,
    cacheReadType: "unknown" as const,
    cacheCreationTokensThisTurn: 0,
    ...overrides,
  }
}

/** Create a minimal AI-only Turn (no user messages). */
function aiTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    timestamp: "2024-01-01T00:00:01Z",
    tokenUsage: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0 },
    messages: [{ type: "assistant" as const, content: [{ type: "text" as const, text: "response" }] }],
    toolCalls: [],
    cacheWriteType: "none" as const,
    cacheReadType: "unknown" as const,
    cacheCreationTokensThisTurn: 0,
    ...overrides,
  }
}

/** Create a Task tool call. */
function taskToolCall(toolUseId = "tc-task-1"): ToolCall {
  return {
    toolUseId,
    name: "Task",
    input: { description: "do something" },
    isTask: true,
    taskDescription: "do something",
    taskSubagentType: "general",
  }
}

describe("conversation-groups", () => {
  describe("buildConversationGroups", () => {
    it("returns empty array for no turns", () => {
      expect(buildConversationGroups([])).toEqual([])
    })

    it("groups user turn followed by AI turns into one group", () => {
      const turns: Turn[] = [
        userTurn({ timestamp: "2024-01-01T00:00:00Z" }),
        aiTurn({ timestamp: "2024-01-01T00:00:02Z" }),
        aiTurn({ timestamp: "2024-01-01T00:00:03Z" }),
      ]

      const groups = buildConversationGroups(turns)

      expect(groups).toHaveLength(1)
      expect(groups[0].userMessage).toBeDefined()
      expect(groups[0].userMessage!.type).toBe("user")
      expect(groups[0].aiResponses).toHaveLength(2)
      expect(groups[0].startTime).toBe("2024-01-01T00:00:00Z")
      expect(groups[0].endTime).toBe("2024-01-01T00:00:03Z")
      expect(groups[0].durationMs).toBe(3000)
      expect(groups[0].totalCost).toBe(0)
    })

    it("creates separate groups for each user turn", () => {
      const turns: Turn[] = [
        userTurn({ timestamp: "2024-01-01T00:00:00Z" }),
        aiTurn({ timestamp: "2024-01-01T00:00:01Z" }),
        userTurn({ timestamp: "2024-01-01T00:00:05Z" }),
        aiTurn({ timestamp: "2024-01-01T00:00:06Z" }),
      ]

      const groups = buildConversationGroups(turns)

      expect(groups).toHaveLength(2)
      expect(groups[0].userMessage).toBeDefined()
      expect(groups[0].aiResponses).toHaveLength(1)
      expect(groups[0].durationMs).toBe(1000)
      expect(groups[1].userMessage).toBeDefined()
      expect(groups[1].aiResponses).toHaveLength(1)
      expect(groups[1].durationMs).toBe(1000)
    })

    it("collects orphaned AI turns into a group with no user message", () => {
      const turns: Turn[] = [
        aiTurn({ timestamp: "2024-01-01T00:00:00Z" }),
        aiTurn({ timestamp: "2024-01-01T00:00:01Z" }),
        userTurn({ timestamp: "2024-01-01T00:00:05Z" }),
        aiTurn({ timestamp: "2024-01-01T00:00:06Z" }),
      ]

      const groups = buildConversationGroups(turns)

      expect(groups).toHaveLength(2)
      // Orphan group
      expect(groups[0].userMessage).toBeUndefined()
      expect(groups[0].aiResponses).toHaveLength(2)
      expect(groups[0].durationMs).toBe(1000)
      // Normal group
      expect(groups[1].userMessage).toBeDefined()
      expect(groups[1].aiResponses).toHaveLength(1)
    })

    it("extracts processIds from Task tool calls", () => {
      const turns: Turn[] = [
        userTurn({
          timestamp: "2024-01-01T00:00:00Z",
          toolCalls: [taskToolCall("tc-1"), taskToolCall("tc-2")],
        }),
        aiTurn({ timestamp: "2024-01-01T00:00:01Z" }),
      ]

      const groups = buildConversationGroups(turns)

      expect(groups).toHaveLength(1)
      expect(groups[0].processIds).toEqual(["tc-1", "tc-2"])
    })

    it("collects tool executions from AI turns", () => {
      const bashCall: ToolCall = {
        toolUseId: "tc-bash",
        name: "Bash",
        input: { command: "ls" },
        isTask: false,
      }
      const turns: Turn[] = [
        userTurn({ timestamp: "2024-01-01T00:00:00Z" }),
        aiTurn({
          timestamp: "2024-01-01T00:00:01Z",
          toolCalls: [bashCall],
        }),
      ]

      const groups = buildConversationGroups(turns)

      expect(groups).toHaveLength(1)
      expect(groups[0].toolExecutions).toHaveLength(1)
      expect(groups[0].toolExecutions[0].name).toBe("Bash")
    })
  })
})
