import { beforeEach, describe, expect, it, vi } from "vitest"
import { extractCommandExecuted, extractFullTimeline, inferCacheReadType, matchTurnsToMessages } from "../src/merger"
import type { RawJsonlRecord, SessionMetadata, Turn } from "../src/types"

// Mock db-reader (other agent is building this)
vi.mock("../src/db-reader", () => ({
  getSession: vi.fn(),
  getTurns: vi.fn(),
}))

// Mock jsonl-parser
vi.mock("../src/jsonl-parser", () => ({
  parseSessionJsonl: vi.fn(),
}))

import { getSession, getTurns } from "../src/db-reader"
import { parseSessionJsonl } from "../src/jsonl-parser"

const mockSession: SessionMetadata = {
  sessionId: "test-session",
  projectName: "/Users/test",
  model: "claude-sonnet-4-6",
  workingDirectory: "/Users/test",
  turnCount: 2,
  totalTokens: {
    inputTokens: 100,
    outputTokens: 200,
    cacheReadTokens: 300,
    cacheCreation5mTokens: 50,
    cacheCreation1hTokens: 20,
  },
  startTime: "2026-05-07T19:22:45.118Z",
  endTime: "2026-05-07T19:22:50.118Z",
}

const mockTurns: Turn[] = [
  {
    timestamp: "2026-05-07T19:22:45.118Z",
    tokenUsage: {
      inputTokens: 50,
      outputTokens: 100,
      cacheReadTokens: 150,
      cacheCreation5mTokens: 25,
      cacheCreation1hTokens: 10,
    },
    toolName: "Bash",
    messages: [],
    toolCalls: [],
    cacheWriteType: "5m",
    cacheReadType: "5m",
    cacheCreationTokensThisTurn: 25,
  },
  {
    timestamp: "2026-05-07T19:22:50.118Z",
    tokenUsage: {
      inputTokens: 50,
      outputTokens: 100,
      cacheReadTokens: 150,
      cacheCreation5mTokens: 25,
      cacheCreation1hTokens: 10,
    },
    toolName: "Read",
    messages: [],
    toolCalls: [],
    cacheWriteType: "5m",
    cacheReadType: "5m",
    cacheCreationTokensThisTurn: 25,
  },
]

describe("merger", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("matchTurnsToMessages", () => {
    it("should match turns to messages by timestamp within 5 seconds", () => {
      const messages: RawJsonlRecord[] = [
        {
          type: "assistant",
          uuid: "1",
          timestamp: "2026-05-07T19:22:45.500Z",
          message: { role: "assistant", content: [] },
        },
        {
          type: "assistant",
          uuid: "2",
          timestamp: "2026-05-07T19:22:55.500Z",
          message: { role: "assistant", content: [] },
        },
      ]

      const result = matchTurnsToMessages(mockTurns, messages)
      expect(result[0].messages.length).toBe(1)
      expect(result[0].messages[0].timestamp).toBe("2026-05-07T19:22:45.500Z")
      expect(result[1].messages.length).toBe(1)
      expect(result[1].messages[0].timestamp).toBe("2026-05-07T19:22:55.500Z")
    })

    it("should use index fallback when no timestamp match", () => {
      const messages: RawJsonlRecord[] = [
        {
          type: "assistant",
          uuid: "1",
          timestamp: "2026-05-07T19:23:00.000Z",
          message: { role: "assistant", content: [] },
        },
        {
          type: "assistant",
          uuid: "2",
          timestamp: "2026-05-07T19:23:01.000Z",
          message: { role: "assistant", content: [] },
        },
      ]

      const result = matchTurnsToMessages(mockTurns, messages)
      expect(result[0].messages.length).toBe(1)
      expect(result[1].messages.length).toBe(1)
    })

    it("should handle empty messages", () => {
      const result = matchTurnsToMessages(mockTurns, [])
      expect(result[0].messages.length).toBe(0)
      expect(result[1].messages.length).toBe(0)
    })

    it("should prefer JSONL cache breakdown over DB total", () => {
      const dbTurns: Turn[] = [{
        timestamp: "2026-05-07T19:22:45.118Z",
        tokenUsage: {
          inputTokens: 2,
          outputTokens: 323,
          cacheReadTokens: 12143,
          cacheCreation5mTokens: 12973, // DB has total, no split
          cacheCreation1hTokens: 0,
        },
        messages: [],
        toolCalls: [],
        cacheWriteType: "5m",
        cacheReadType: "5m",
        cacheCreationTokensThisTurn: 12973,
      }]

      const jsonlMessages: RawJsonlRecord[] = [{
        type: "assistant",
        uuid: "1",
        timestamp: "2026-05-07T19:22:45.118Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
          usage: {
            cache_creation: {
              ephemeral_5m_input_tokens: 0,
              ephemeral_1h_input_tokens: 12973,
            },
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 12973,
          },
        },
      }]

      const result = matchTurnsToMessages(dbTurns, jsonlMessages)
      expect(result[0].tokenUsage.cacheCreation5mTokens).toBe(0)
      expect(result[0].tokenUsage.cacheCreation1hTokens).toBe(12973)
    })

    it("should fall back to DB values when JSONL has no cache breakdown", () => {
      const dbTurns: Turn[] = [{
        timestamp: "2026-05-07T19:22:45.118Z",
        tokenUsage: {
          inputTokens: 2,
          outputTokens: 323,
          cacheReadTokens: 12143,
          cacheCreation5mTokens: 5000,
          cacheCreation1hTokens: 0,
        },
        messages: [],
        toolCalls: [],
        cacheWriteType: "5m",
        cacheReadType: "5m",
        cacheCreationTokensThisTurn: 5000,
      }]

      const jsonlMessages: RawJsonlRecord[] = [{
        type: "assistant",
        uuid: "1",
        timestamp: "2026-05-07T19:22:45.118Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
          // No usage.cache_creation in JSONL
        },
      }]

      const result = matchTurnsToMessages(dbTurns, jsonlMessages)
      expect(result[0].tokenUsage.cacheCreation5mTokens).toBe(5000)
      expect(result[0].tokenUsage.cacheCreation1hTokens).toBe(0)
    })
  })

  describe("inferCacheReadType", () => {
    it("should return 5m for first turn", () => {
      const result = inferCacheReadType(0, mockTurns, mockTurns[0].timestamp)
      expect(result).toBe("5m")
    })

    it("should return 5m when within 5 minute window", () => {
      const result = inferCacheReadType(1, mockTurns, mockTurns[1].timestamp)
      expect(result).toBe("5m")
    })

    it("should return 5m as default", () => {
      const turns = [
        { timestamp: "2026-05-07T19:00:00.000Z", cacheWriteType: "5m" },
        { timestamp: "2026-05-07T19:30:00.000Z", cacheWriteType: "5m" },
      ] as any[]
      const result = inferCacheReadType(1, turns, turns[1].timestamp)
      expect(result).toBe("5m")
    })
  })

  describe("extractCommandExecuted", () => {
    it("should extract command from first user message with command-name tag", () => {
      const messages: RawJsonlRecord[] = [
        {
          type: "user",
          uuid: "1",
          timestamp: "2026-05-07T19:22:39.000Z",
          message: {
            role: "user",
            content: "<command-message>claude-hud:setup</command-message>\n<command-name>/claude-hud:setup</command-name>",
          },
        },
      ]
      const result = extractCommandExecuted(messages)
      expect(result).toBe("/claude-hud:setup")
    })

    it("should return undefined for sessions without command", () => {
      const messages: RawJsonlRecord[] = [
        {
          type: "user",
          uuid: "1",
          timestamp: "2026-05-07T19:22:39.000Z",
          message: { role: "user", content: "Fix the bug in auth.ts" },
        },
      ]
      const result = extractCommandExecuted(messages)
      expect(result).toBeUndefined()
    })

    it("should return undefined for empty messages", () => {
      expect(extractCommandExecuted([])).toBeUndefined()
    })

    it("should only check first user message, not scan later ones", () => {
      const messages: RawJsonlRecord[] = [
        {
          type: "user",
          uuid: "1",
          timestamp: "2026-05-07T19:22:39.000Z",
          message: { role: "user", content: "No command here" },
        },
        {
          type: "user",
          uuid: "2",
          timestamp: "2026-05-07T19:22:40.000Z",
          message: {
            role: "user",
            content: "<command-name>/some-command</command-name>",
          },
        },
      ]
      const result = extractCommandExecuted(messages)
      expect(result).toBeUndefined()
    })
  })

  describe("extractFullTimeline", () => {
    it("should return FullTimelineSession with all fields", async () => {
      vi.mocked(getSession).mockReturnValue(mockSession)
      vi.mocked(getTurns).mockReturnValue(mockTurns)
      vi.mocked(parseSessionJsonl).mockReturnValue({
        rawMessages: [
          {
            type: "assistant",
            uuid: "1",
            timestamp: "2026-05-07T19:22:45.500Z",
            message: { role: "assistant", content: [] },
          },
        ],
        toolCalls: [],
        malformedCount: 0,
      })

      const result = await extractFullTimeline("test-session", "/tmp/usage.db", "/tmp/projects")

      expect(result.session.sessionId).toBe("test-session")
      expect(result.turns.length).toBe(2)
      expect(result.pricing.totalCost).toBeGreaterThan(0)
    })

    it("should handle missing JSONL gracefully", async () => {
      vi.mocked(getSession).mockReturnValue(mockSession)
      vi.mocked(getTurns).mockReturnValue(mockTurns)
      vi.mocked(parseSessionJsonl).mockReturnValue(null)

      const result = await extractFullTimeline("test-session", "/tmp/usage.db", "/tmp/projects")

      expect(result.session.sessionId).toBe("test-session")
      expect(result.turns.length).toBe(2)
      expect(result.turns[0].messages.length).toBe(0)
    })

    it("should set session.commandExecuted from first user command tag", async () => {
      vi.mocked(getSession).mockReturnValue(mockSession)
      vi.mocked(getTurns).mockReturnValue(mockTurns)
      vi.mocked(parseSessionJsonl).mockReturnValue({
        rawMessages: [
          {
            type: "user",
            uuid: "u1",
            timestamp: "2026-05-07T19:22:39.000Z",
            message: {
              role: "user",
              content: "<command-name>/claude-hud:setup</command-name>",
            },
          },
        ],
        toolCalls: [],
        malformedCount: 0,
      })

      const result = await extractFullTimeline("test-session", "/tmp/usage.db", "/tmp/projects")
      expect(result.session.commandExecuted).toBe("/claude-hud:setup")
    })
  })
})
