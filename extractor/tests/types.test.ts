import { describe, expect, test } from "vitest"
import type {
  FullTimelineSession,
  Message,
  PricingRate,
  RawJsonlRecord,
  SessionMetadata,
  SessionPricing,
  TextContent,
  TokenUsage,
  ToolCall,
  ToolResultContent,
  ToolUseContent,
  Turn,
  TurnPricing,
} from "../src/types.js"

describe("TokenUsage", () => {
  test("has all 6 fields", () => {
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 300,
      cacheCreation5mTokens: 400,
      cacheCreation1hTokens: 500,
    }
    expect(usage.inputTokens).toBe(100)
    expect(usage.outputTokens).toBe(200)
    expect(usage.cacheReadTokens).toBe(300)
    expect(usage.cacheCreation5mTokens).toBe(400)
    expect(usage.cacheCreation1hTokens).toBe(500)
  })

  test("cacheCreationTokens is optional", () => {
    const usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      cacheCreationTokens: 100,
    }
    expect(usage.cacheCreationTokens).toBe(100)
  })
})

describe("RawJsonlRecord", () => {
  test("can be instantiated with minimal fields", () => {
    const record: RawJsonlRecord = {
      type: "assistant",
    }
    expect(record.type).toBe("assistant")
  })

  test("supports full message structure", () => {
    const record: RawJsonlRecord = {
      type: "assistant",
      timestamp: "2026-05-07T19:22:45.118Z",
      uuid: "abc-123",
      parentUuid: "def-456",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
        model: "claude-sonnet-4-6",
        usage: {
          inputTokens: 100,
          outputTokens: 200,
          cacheReadTokens: 300,
          cacheCreation5mTokens: 0,
          cacheCreation1hTokens: 0,
        },
      },
    }
    expect(record.message?.model).toBe("claude-sonnet-4-6")
  })
})

describe("MessageContent types", () => {
  test("TextContent has correct shape", () => {
    const content: TextContent = { type: "text", text: "hello" }
    expect(content.type).toBe("text")
  })

  test("ToolUseContent has correct shape", () => {
    const content: ToolUseContent = {
      type: "tool_use",
      name: "Bash",
      input: { command: "ls" },
      toolUseId: "tool-123",
    }
    expect(content.type).toBe("tool_use")
    expect(content.name).toBe("Bash")
  })

  test("ToolResultContent has correct shape", () => {
    const content: ToolResultContent = {
      type: "tool_result",
      toolUseId: "tool-123",
      content: "output here",
      isError: false,
    }
    expect(content.type).toBe("tool_result")
  })
})

describe("Message", () => {
  test("can be instantiated", () => {
    const msg: Message = {
      type: "assistant",
      content: [{ type: "text", text: "hello" }],
    }
    expect(msg.type).toBe("assistant")
    expect(msg.content).toHaveLength(1)
  })
})

describe("ToolCall", () => {
  test("has required fields", () => {
    const call: ToolCall = {
      toolUseId: "tool-123",
      name: "Bash",
      input: { command: "ls -la" },
    }
    expect(call.toolUseId).toBe("tool-123")
    expect(call.name).toBe("Bash")
  })

  test("supports optional result and error fields", () => {
    const call: ToolCall = {
      toolUseId: "tool-123",
      name: "Bash",
      input: { command: "ls" },
      result: "file1.txt",
      isError: false,
      timestamp: "2026-05-07T19:22:45.118Z",
    }
    expect(call.isError).toBe(false)
  })
})

describe("Turn", () => {
  test("has cacheWriteType and cacheReadType enums", () => {
    const turn: Turn = {
      timestamp: "2026-05-07T19:22:45.118Z",
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
      },
      messages: [],
      toolCalls: [],
      cacheWriteType: "5m",
      cacheReadType: "5m",
      cacheCreationTokensThisTurn: 100,
    }
    expect(turn.cacheWriteType).toBe("5m")
    expect(turn.cacheReadType).toBe("5m")
  })

  test("cacheWriteType accepts 'none'", () => {
    const turn: Turn = {
      timestamp: "2026-05-07T19:22:45.118Z",
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
      },
      messages: [],
      toolCalls: [],
      cacheWriteType: "none",
      cacheReadType: "unknown",
      cacheCreationTokensThisTurn: 0,
    }
    expect(turn.cacheWriteType).toBe("none")
  })
})

describe("SessionMetadata", () => {
  test("can be instantiated", () => {
    const session: SessionMetadata = {
      sessionId: "19500eaa-3cc6-4111-a82d-f158e7f76ad3",
      projectName: "test-project",
      model: "claude-sonnet-4-6",
      workingDirectory: "/Users/test",
      turnCount: 28,
      totalTokens: {
        inputTokens: 30,
        outputTokens: 14550,
        cacheReadTokens: 929057,
        cacheCreation5mTokens: 34383,
        cacheCreation1hTokens: 0,
      },
      startTime: "2026-05-07T19:22:45.118Z",
      endTime: "2026-05-07T19:50:00.000Z",
    }
    expect(session.sessionId).toBe("19500eaa-3cc6-4111-a82d-f158e7f76ad3")
    expect(session.turnCount).toBe(28)
  })
})

describe("PricingRate", () => {
  test("has all pricing fields", () => {
    const rate: PricingRate = {
      model: "claude-sonnet-4-6",
      inputPerMTok: 3.0,
      outputPerMTok: 15.0,
      cacheReadPerMTok: 0.3,
      cacheCreation5mPerMTok: 3.75,
      cacheCreation1hPerMTok: 6.0,
    }
    expect(rate.model).toBe("claude-sonnet-4-6")
    expect(rate.cacheReadPerMTok).toBe(0.3)
  })
})

describe("TurnPricing", () => {
  test("has cost breakdown fields", () => {
    const pricing: TurnPricing = {
      inputCost: 0.001,
      outputCost: 0.02,
      cacheReadCost: 0.01,
      cacheCreation5mCost: 0.005,
      cacheCreation1hCost: 0.0,
      totalCost: 0.036,
    }
    expect(pricing.totalCost).toBeCloseTo(0.036)
  })
})

describe("SessionPricing", () => {
  test("composes correctly", () => {
    const pricing: SessionPricing = {
      estimatedTotalCost: 0.63,
      apiTotalCost: null,
      apiSnapshotCount: 0,
      apiLastSnapshotAt: null,
      totalCost: 0.63,
      costSource: "estimated",
      turnsPricing: [],
      pricingRate: {
        model: "claude-sonnet-4-6",
        inputPerMTok: 3.0,
        outputPerMTok: 15.0,
        cacheReadPerMTok: 0.3,
        cacheCreation5mPerMTok: 3.75,
        cacheCreation1hPerMTok: 6.0,
      },
    }
    expect(pricing.totalCost).toBe(0.63)
    expect(pricing.turnsPricing).toHaveLength(0)
  })
})

describe("FullTimelineSession", () => {
  test("composes session, turns, and pricing", () => {
    const session: FullTimelineSession = {
      session: {
        sessionId: "test-id",
        projectName: "test",
        model: "claude-sonnet-4-6",
        workingDirectory: "/test",
        turnCount: 1,
        totalTokens: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreation5mTokens: 0,
          cacheCreation1hTokens: 0,
        },
        startTime: "2026-01-01T00:00:00Z",
        endTime: "2026-01-01T00:01:00Z",
      },
      turns: [],
      pricing: {
        estimatedTotalCost: 0,
        apiTotalCost: null,
        apiSnapshotCount: 0,
        apiLastSnapshotAt: null,
        totalCost: 0,
        costSource: "estimated",
        turnsPricing: [],
        pricingRate: {
          model: "claude-sonnet-4-6",
          inputPerMTok: 3.0,
          outputPerMTok: 15.0,
          cacheReadPerMTok: 0.3,
          cacheCreation5mPerMTok: 3.75,
          cacheCreation1hPerMTok: 6.0,
        },
      },
    }
    expect(session.session.sessionId).toBe("test-id")
    expect(session.turns).toHaveLength(0)
    expect(session.pricing.totalCost).toBe(0)
  })
})
