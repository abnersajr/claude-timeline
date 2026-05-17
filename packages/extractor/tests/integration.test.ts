import { execSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

const extractorDir = path.resolve(__dirname, "..")

describe("integration", () => {
  it("should exit with error when --session-id is missing", () => {
    try {
      execSync("npx tsx src/index.ts", {
        encoding: "utf-8",
        cwd: extractorDir,
      })
      expect.fail("Should have thrown")
    } catch (err: any) {
      expect(err.status).toBe(1)
      expect(err.stderr || err.stdout).toContain("session-id")
    }
  })

  it("should produce valid JSON output for real session", () => {
    const dbPath = path.join(os.homedir(), ".claude", "usage.db")
    if (!fs.existsSync(dbPath)) {
      console.warn("Skipping integration test: no usage.db found")
      return
    }

    // Get a real session ID
    let sessionId: string
    try {
      sessionId = execSync(`sqlite3 "${dbPath}" "SELECT session_id FROM sessions LIMIT 1;"`, {
        encoding: "utf-8",
      }).trim()
    } catch {
      console.warn("Skipping: could not query usage.db")
      return
    }

    if (!sessionId) {
      console.warn("Skipping: no sessions in usage.db")
      return
    }

    const result = execSync(`npx tsx src/index.ts --session-id ${sessionId}`, {
      encoding: "utf-8",
      cwd: extractorDir,
    })

    const parsed = JSON.parse(result)
    expect(parsed.session).toBeDefined()
    expect(parsed.turns).toBeDefined()
    expect(parsed.pricing).toBeDefined()
    expect(parsed.session.sessionId).toBe(sessionId)
  })
})
