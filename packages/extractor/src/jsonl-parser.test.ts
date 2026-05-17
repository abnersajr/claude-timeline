import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { parseSessionJsonl } from "../src/jsonl-parser"

const testDir = join(tmpdir(), "jsonl-parser-test-" + Date.now())

function makeJsonlPath(name: string): string {
  return join(testDir, `${name}.jsonl`)
}

function writeJsonl(path: string, entries: Record<string, unknown>[]): void {
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n")
}

function makeAssistantRecord(
  uuid: string,
  toolUseId: string,
  command: string,
  timestamp = "2024-01-01T00:00:00Z",
): Record<string, unknown> {
  return {
    type: "assistant",
    uuid,
    timestamp,
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: toolUseId,
          name: "Bash",
          input: { command },
        },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    },
  }
}

function makeHookSuccessRecord(
  toolUseID: string,
  rewrittenCommand: string,
  parentUuid?: string,
): Record<string, unknown> {
  return {
    type: "attachment",
    parentUuid,
    attachment: {
      type: "hook_success",
      hookName: "PreToolUse:Bash",
      toolUseID,
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecisionReason: "RTK auto-rewrite",
          updatedInput: { command: rewrittenCommand },
        },
      }),
    },
  }
}

describe("jsonl-parser", () => {
  beforeAll(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up test files
    for (const f of [
      "hook-rewrite.jsonl",
      "no-hook-rewrite.jsonl",
      "non-bash-hook.jsonl",
      "malformed-hook.jsonl",
      "partial-rewrite.jsonl",
    ]) {
      const p = join(testDir, f)
      if (existsSync(p)) rmSync(p)
    }
  })

  describe("hook rewrite extraction", () => {
    it("attaches hookRewrite to tool calls with matching hook_success", () => {
      const path = makeJsonlPath("hook-rewrite")
      writeJsonl(path, [
        makeAssistantRecord("uuid-1", "toolu_001", "grep -r 'foo' src/"),
        makeHookSuccessRecord("toolu_001", "rtk grep -r 'foo' src/", "uuid-1"),
      ])

      const result = parseSessionJsonl(path, "test-session")
      expect(result).not.toBeNull()
      expect(result!.toolCalls).toHaveLength(1)
      expect(result!.toolCalls[0].hookRewrite).toEqual({
        command: "rtk grep -r 'foo' src/",
      })
    })

    it("does not attach hookRewrite when no matching hook_success exists", () => {
      const path = makeJsonlPath("no-hook-rewrite")
      writeJsonl(path, [
        makeAssistantRecord("uuid-1", "toolu_001", "ls -la"),
      ])

      const result = parseSessionJsonl(path, "test-session")
      expect(result).not.toBeNull()
      expect(result!.toolCalls).toHaveLength(1)
      expect(result!.toolCalls[0].hookRewrite).toBeUndefined()
    })

    it("ignores non-Bash hook hooks", () => {
      const path = makeJsonlPath("non-bash-hook")
      writeJsonl(path, [
        makeAssistantRecord("uuid-1", "toolu_001", "git status"),
        {
          type: "attachment",
          attachment: {
            type: "hook_success",
            hookName: "PreToolUse:Read",
            toolUseID: "toolu_001",
            stdout: JSON.stringify({
              hookSpecificOutput: {
                updatedInput: { file_path: "/some/file" },
              },
            }),
          },
        },
      ])

      const result = parseSessionJsonl(path, "test-session")
      expect(result!.toolCalls[0].hookRewrite).toBeUndefined()
    })

    it("handles malformed hook stdout gracefully", () => {
      const path = makeJsonlPath("malformed-hook")
      writeJsonl(path, [
        makeAssistantRecord("uuid-1", "toolu_001", "ls"),
        {
          type: "attachment",
          attachment: {
            type: "hook_success",
            hookName: "PreToolUse:Bash",
            toolUseID: "toolu_001",
            stdout: "not valid json{{{",
          },
        },
      ])

      const result = parseSessionJsonl(path, "test-session")
      expect(result!.toolCalls).toHaveLength(1)
      expect(result!.toolCalls[0].hookRewrite).toBeUndefined()
    })

    it("matches hook rewrite to correct tool call by toolUseId", () => {
      const path = makeJsonlPath("partial-rewrite")
      writeJsonl(path, [
        makeAssistantRecord("uuid-1", "toolu_001", "grep -r 'a' src/"),
        makeAssistantRecord("uuid-2", "toolu_002", "cat file.txt"),
        makeHookSuccessRecord("toolu_001", "rtk grep -r 'a' src/", "uuid-1"),
        // No hook for toolu_002
      ])

      const result = parseSessionJsonl(path, "test-session")
      expect(result!.toolCalls).toHaveLength(2)
      expect(result!.toolCalls[0].hookRewrite).toEqual({
        command: "rtk grep -r 'a' src/",
      })
      expect(result!.toolCalls[1].hookRewrite).toBeUndefined()
    })
  })
})
