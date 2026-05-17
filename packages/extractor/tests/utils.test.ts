import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
  encodeProjectName,
  getDbPath,
  getProjectsDir,
  resolveSessionJsonlPath,
} from "../src/utils.js"

let originalEnv: string | undefined

beforeEach(() => {
  originalEnv = process.env.CLAUDE_CONFIG_DIR
})

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalEnv
  }
})

describe("getDbPath", () => {
  test("returns custom path when provided", () => {
    expect(getDbPath("/custom/path/usage.db")).toBe("/custom/path/usage.db")
  })

  test("uses CLAUDE_CONFIG_DIR env var when set", () => {
    process.env.CLAUDE_CONFIG_DIR = "/tmp/test-claude"
    expect(getDbPath()).toBe("/tmp/test-claude/usage.db")
  })

  test("falls back to ~/.claude/usage.db when env not set", () => {
    delete process.env.CLAUDE_CONFIG_DIR
    const result = getDbPath()
    expect(result).toContain(".claude")
    expect(result).toContain("usage.db")
  })
})

describe("getProjectsDir", () => {
  test("returns custom path when provided", () => {
    expect(getProjectsDir("/custom/projects")).toBe("/custom/projects")
  })

  test("uses CLAUDE_CONFIG_DIR env var when set", () => {
    process.env.CLAUDE_CONFIG_DIR = "/tmp/test-claude"
    expect(getProjectsDir()).toBe("/tmp/test-claude/projects")
  })

  test("falls back to ~/.claude/projects when env not set", () => {
    delete process.env.CLAUDE_CONFIG_DIR
    const result = getProjectsDir()
    expect(result).toContain(".claude")
    expect(result).toContain("projects")
  })
})

describe("encodeProjectName", () => {
  test("replaces / with -", () => {
    expect(encodeProjectName("/Users/test")).toBe("-Users-test")
  })

  test("handles nested paths", () => {
    expect(encodeProjectName("/Users/test/projects/foo")).toBe("-Users-test-projects-foo")
  })

  test("handles paths without leading slash", () => {
    expect(encodeProjectName("Users/test")).toBe("Users-test")
  })
})

describe("resolveSessionJsonlPath", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-resolve-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up is best-effort in tests
    try {
      const { rmSync } = require("node:fs")
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  test("returns path when file exists (encoded name)", () => {
    const encoded = encodeProjectName("/Users/test")
    const sessionDir = join(tempDir, encoded)
    mkdirSync(sessionDir, { recursive: true })
    const sessionFile = join(sessionDir, "abc-123.jsonl")
    writeFileSync(sessionFile, "{}")

    const result = resolveSessionJsonlPath(
      { projectName: "/Users/test", sessionId: "abc-123" },
      tempDir,
    )
    expect(result).toBe(sessionFile)
  })

  test("returns null when file does not exist", () => {
    const result = resolveSessionJsonlPath(
      { projectName: "/nonexistent", sessionId: "missing-id" },
      tempDir,
    )
    expect(result).toBeNull()
  })
})
