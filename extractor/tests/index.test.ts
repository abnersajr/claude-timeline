import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { outputJSON, parseArgs } from "../src/index"
import type { FullTimelineSession } from "../src/types"

describe("index", () => {
  let originalLog: typeof console.log
  let originalError: typeof console.error
  let logOutput: string[]
  let errorOutput: string[]

  beforeEach(() => {
    originalLog = console.log
    originalError = console.error
    logOutput = []
    errorOutput = []
    console.log = (...args: unknown[]) => logOutput.push(String(args[0]))
    console.error = (...args: unknown[]) => errorOutput.push(String(args[0]))
  })

  afterEach(() => {
    console.log = originalLog
    console.error = originalError
  })

  describe("parseArgs", () => {
    it("should parse args with session-id", () => {
      const config = parseArgs(["node", "src/index.ts", "--session-id", "test-123"])
      expect(config.sessionId).toBe("test-123")
    })

    it("should throw without session-id", () => {
      expect(() => parseArgs(["node", "src/index.ts"])).toThrow()
    })

    it("should use default paths when not specified", () => {
      const config = parseArgs(["node", "src/index.ts", "--session-id", "test"])
      expect(config.dbPath).toContain("usage.db")
      expect(config.projectsDir).toContain("projects")
    })

    it("should accept custom paths", () => {
      const config = parseArgs([
        "node",
        "src/index.ts",
        "--session-id",
        "test",
        "--db-path",
        "/custom/usage.db",
        "--projects-dir",
        "/custom/projects",
      ])
      expect(config.dbPath).toBe("/custom/usage.db")
      expect(config.projectsDir).toBe("/custom/projects")
    })

    it("should accept output path", () => {
      const config = parseArgs([
        "node",
        "src/index.ts",
        "--session-id",
        "test",
        "--output",
        "/tmp/out.json",
      ])
      expect(config.outputPath).toBe("/tmp/out.json")
    })

    it("should default outputPath to null", () => {
      const config = parseArgs(["node", "src/index.ts", "--session-id", "test"])
      expect(config.outputPath).toBeNull()
    })

    it("should parse --list-sessions flag", () => {
      const config = parseArgs(["node", "src/index.ts", "--list-sessions"])
      expect(config.listSessions).toBe(true)
      expect(config.sessionId).toBeNull()
    })

    it("should not require --session-id when --list-sessions is set", () => {
      expect(() => parseArgs(["node", "src/index.ts", "--list-sessions"])).not.toThrow()
    })
  })

  describe("outputJSON", () => {
    const mockData: FullTimelineSession = {
      session: { sessionId: "test" } as any,
      turns: [],
      pricing: { totalCost: 0 } as any,
    }

    it("should output JSON to stdout when outputPath is null", () => {
      outputJSON(mockData, null)
      expect(logOutput.length).toBe(1)
      const parsed = JSON.parse(logOutput[0])
      expect(parsed.session.sessionId).toBe("test")
    })

    it("should pretty-print JSON with 2-space indent", () => {
      outputJSON(mockData, null)
      expect(logOutput[0]).toContain("  ")
    })
  })
})
