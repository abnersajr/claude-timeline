# Extractor Gap Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Close all data-extraction gaps in `@timeline/extractor` by adopting proven patterns from claude-devtools, producing a rich, accurately-costed timeline output.

**Architecture:** Each gap is a self-contained module under `extractor/src/`. Modules are pure functions — no side effects, no classes. Each gets its own test file. The merger orchestrates them into the final `FullTimelineSession` output. No barrel files — direct submodule imports via package.json `exports` map.

**Tech Stack:** TypeScript, Vitest, Biome, better-sqlite3. No new dependencies.

**Reference codebase:** `/tmp/claude-devtools/src/main/` — patterns adapted, not copied verbatim.

---

## Phase 1: Data Accuracy (HIGH Priority)

### Task 1: Request ID Deduplication

**Objective:** Prevent double-counting tokens from streaming responses where Claude Code writes multiple JSONL entries per API call with the same `requestId`.

**Why this is first:** Every downstream calculation (cost, metrics, per-turn breakdowns) is wrong if we sum tokens from duplicate entries. This is a data-correctness foundation.

**Files:**
- Create: `extractor/src/dedup.ts`
- Create: `extractor/src/dedup.test.ts`
- Modify: `extractor/src/jsonl-parser.ts:32-99` (integrate dedup into parse loop)
- Modify: `extractor/src/types.ts` (add `requestId` to `RawJsonlRecord`)

**Step 1: Add `requestId` field to `RawJsonlRecord`**

In `extractor/src/types.ts`, add to the `RawJsonlRecord` interface:

```typescript
export interface RawJsonlRecord {
  type: string
  timestamp?: string
  uuid?: string
  parentUuid?: string
  requestId?: string  // <-- ADD THIS
  message?: {
    // ... existing fields unchanged
  }
  toolUseResult?: {
    // ... existing fields unchanged
  }
}
```

**Step 2: Write failing test for `deduplicateByRequestId`**

Create `extractor/src/dedup.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { deduplicateByRequestId } from "./dedup"
import type { RawJsonlRecord } from "./types"

function makeRecord(
  overrides: Partial<RawJsonlRecord> & { requestId?: string },
): RawJsonlRecord {
  return {
    type: "assistant",
    uuid: "uuid-1",
    message: {
      role: "assistant",
      content: [],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
    ...overrides,
  }
}

describe("deduplicateByRequestId", () => {
  it("keeps the last entry per requestId with highest output_tokens", () => {
    const records: RawJsonlRecord[] = [
      makeRecord({
        uuid: "uuid-1",
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [],
          usage: {
            input_tokens: 100,
            output_tokens: 30,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
      makeRecord({
        uuid: "uuid-2",
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    ]

    const result = deduplicateByRequestId(records)
    expect(result).toHaveLength(1)
    expect(result[0].uuid).toBe("uuid-2")
    expect(result[0].message?.usage?.output_tokens).toBe(50)
  })

  it("passes through user messages without requestId", () => {
    const records: RawJsonlRecord[] = [
      {
        type: "user",
        uuid: "uuid-3",
        message: { role: "user", content: [{ type: "text", text: "hello" }] },
      },
    ]

    const result = deduplicateByRequestId(records)
    expect(result).toHaveLength(1)
    expect(result[0].uuid).toBe("uuid-3")
  })

  it("deduplicates assistant entries but keeps user/system entries", () => {
    const records: RawJsonlRecord[] = [
      {
        type: "user",
        uuid: "uuid-u",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      },
      makeRecord({
        uuid: "uuid-1",
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [],
          usage: {
            input_tokens: 100,
            output_tokens: 10,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
      makeRecord({
        uuid: "uuid-2",
        requestId: "req-1",
        message: {
          role: "assistant",
          content: [],
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    ]

    const result = deduplicateByRequestId(records)
    expect(result).toHaveLength(2) // 1 user + 1 deduped assistant
    expect(result[0].type).toBe("user")
    expect(result[1].uuid).toBe("uuid-2")
  })

  it("handles entries without requestId by keeping them all", () => {
    const records: RawJsonlRecord[] = [
      makeRecord({ uuid: "uuid-1" }),
      makeRecord({ uuid: "uuid-2" }),
    ]

    const result = deduplicateByRequestId(records)
    expect(result).toHaveLength(2)
  })
})
```

**Step 3: Run test to verify failure**

Run: `cd extractor && npx vitest run src/dedup.test.ts`
Expected: FAIL — module not found

**Step 4: Implement `deduplicateByRequestId`**

Create `extractor/src/dedup.ts`:

```typescript
import type { RawJsonlRecord } from "./types"

/**
 * Deduplicate streaming entries by requestId.
 *
 * Claude Code writes multiple JSONL entries per API response during streaming,
 * each with the same requestId but incrementally increasing output_tokens.
 * Only the last entry per requestId has final, complete token counts.
 *
 * Strategy: For entries sharing a requestId, keep the one with the highest
 * output_tokens (the last streaming chunk). Entries without requestId pass through.
 */
export function deduplicateByRequestId(records: RawJsonlRecord[]): RawJsonlRecord[] {
  const result: RawJsonlRecord[] = []
  const seenRequestIds = new Map<string, { index: number; outputTokens: number }>()

  for (const record of records) {
    const requestId = record.requestId

    // No requestId → pass through (user messages, system messages)
    if (!requestId) {
      result.push(record)
      continue
    }

    const outputTokens = record.message?.usage?.output_tokens ?? 0
    const existing = seenRequestIds.get(requestId)

    if (!existing) {
      // First entry for this requestId — tentatively keep it
      seenRequestIds.set(requestId, { index: result.length, outputTokens })
      result.push(record)
    } else if (outputTokens >= existing.outputTokens) {
      // Newer/higher entry — replace the previous one
      result[existing.index] = record
      existing.outputTokens = outputTokens
    }
    // else: older/lower entry — discard
  }

  return result
}
```

**Step 5: Run test to verify pass**

Run: `cd extractor && npx vitest run src/dedup.test.ts`
Expected: 4 tests PASS

**Step 6: Integrate into `jsonl-parser.ts`**

In `extractor/src/jsonl-parser.ts`, add import and call after parsing all lines:

```typescript
import { deduplicateByRequestId } from "./dedup"

// ... existing parseSessionJsonl function ...

// After the for-loop (line 99), before return:
const dedupedMessages = deduplicateByRequestId(rawMessages)

return { rawMessages: dedupedMessages, toolCalls, malformedCount }
```

**Step 7: Run all extractor tests**

Run: `cd extractor && npx vitest run`
Expected: All tests PASS (existing + new dedup tests)

**Step 8: Commit**

```bash
git add extractor/src/types.ts extractor/src/dedup.ts extractor/src/dedup.test.ts extractor/src/jsonl-parser.ts
git commit -m "feat(extractor): add request-id deduplication for streaming entries"
```

---

### Task 2: Message Classification

**Objective:** Classify every JSONL message into a typed category (user, assistant, system, compact, hardNoise) with proper type guards, replacing the current binary noise filter.

**Why this is second:** Classification is the foundation for conversation groups, subagent resolution, and context tracking. Every downstream module needs to know "what kind of message is this?"

**Files:**
- Create: `extractor/src/classifier.ts`
- Create: `extractor/src/classifier.test.ts`
- Modify: `extractor/src/types.ts` (add `MessageCategory`, type guard types, `isMeta` field)
- Modify: `extractor/src/jsonl-parser.ts` (classify during parse)
- Deprecate: `extractor/src/noise-filter.ts` (replaced by classifier)

**Step 1: Extend `RawJsonlRecord` with classification fields**

In `extractor/src/types.ts`, add:

```typescript
export interface RawJsonlRecord {
  type: string
  timestamp?: string
  uuid?: string
  parentUuid?: string
  requestId?: string
  isMeta?: boolean          // <-- ADD: true = internal/tool-result
  isSidechain?: boolean     // <-- ADD: subagent message
  isCompactSummary?: boolean // <-- ADD: compaction boundary
  agentId?: string          // <-- ADD: subagent identifier
  message?: {
    role: string
    content: Array<Record<string, unknown>> | string
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
      cache_creation?: {
        ephemeral_5m_input_tokens?: number
        ephemeral_1h_input_tokens?: number
      }
      cacheCreation5mTokens?: number
      cacheCreation1hTokens?: number
    }
  }
  toolUseResult?: {
    toolUseId: string
    content: unknown
    isError?: boolean
  }
  sourceToolUseID?: string  // <-- ADD: links tool result → tool call
}
```

Add message category type and type guards:

```typescript
/** Message classification categories */
export type MessageCategory = "user" | "assistant" | "system" | "compact" | "hardNoise"

/** Classified message with its category */
export interface ClassifiedMessage {
  record: RawJsonlRecord
  category: MessageCategory
}
```

**Step 2: Write failing tests for classifier**

Create `extractor/src/classifier.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { classifyMessage, classifyMessages } from "./classifier"
import type { RawJsonlRecord } from "./types"

function makeUserRecord(
  content: string | Array<Record<string, unknown>>,
  overrides: Partial<RawJsonlRecord> = {},
): RawJsonlRecord {
  return {
    type: "user",
    uuid: "test-uuid",
    message: { role: "user", content },
    ...overrides,
  }
}

function makeAssistantRecord(
  content: Array<Record<string, unknown>> = [],
  overrides: Partial<RawJsonlRecord> = {},
): RawJsonlRecord {
  return {
    type: "assistant",
    uuid: "test-uuid",
    message: { role: "assistant", content },
    ...overrides,
  }
}

describe("classifyMessage", () => {
  it("classifies real user text as 'user'", () => {
    const msg = makeUserRecord("fix the bug")
    expect(classifyMessage(msg)).toBe("user")
  })

  it("classifies user message with isMeta=true as 'assistant' (internal)", () => {
    const msg = makeUserRecord([{ type: "tool_result", toolUseId: "x", content: "ok" }], {
      isMeta: true,
    })
    expect(classifyMessage(msg)).toBe("assistant")
  })

  it("classifies command output as 'system'", () => {
    const msg = makeUserRecord("<local-command-stdout>\nls -la\n</local-command-stdout>")
    expect(classifyMessage(msg)).toBe("system")
  })

  it("classifies hard noise tags as 'hardNoise'", () => {
    const msg = makeUserRecord("<local-command-caveat>\nrun this manually\n</local-command-caveat>")
    expect(classifyMessage(msg)).toBe("hardNoise")
  })

  it("classifies system-reminder as 'hardNoise'", () => {
    const msg = makeUserRecord("<system-reminder>don't forget</system-reminder>")
    expect(classifyMessage(msg)).toBe("hardNoise")
  })

  it("classifies compact summary as 'compact'", () => {
    const msg = makeUserRecord("summary text", { isCompactSummary: true })
    expect(classifyMessage(msg)).toBe("compact")
  })

  it("classifies synthetic assistant as 'hardNoise'", () => {
    const msg = makeAssistantRecord([], {})
    msg.message!.model = "<synthetic>"
    expect(classifyMessage(msg)).toBe("hardNoise")
  })

  it("classifies assistant message as 'assistant'", () => {
    const msg = makeAssistantRecord([{ type: "text", text: "here's the fix" }])
    expect(classifyMessage(msg)).toBe("assistant")
  })

  it("classifies system type as 'hardNoise'", () => {
    const msg: RawJsonlRecord = {
      type: "system",
      uuid: "u",
      message: { role: "system", content: [] },
    }
    expect(classifyMessage(msg)).toBe("hardNoise")
  })

  it("classifies summary type as 'hardNoise'", () => {
    const msg: RawJsonlRecord = {
      type: "summary",
      uuid: "u",
      message: { role: "system", content: [] },
    }
    expect(classifyMessage(msg)).toBe("hardNoise")
  })

  it("classifies user with only tool_result blocks as 'assistant'", () => {
    const msg = makeUserRecord(
      [{ type: "tool_result", toolUseId: "x", content: "done" }],
      { isMeta: true },
    )
    expect(classifyMessage(msg)).toBe("assistant")
  })

  it("classifies user with text + tool_result as 'user' if isMeta is false", () => {
    const msg = makeUserRecord([
      { type: "text", text: "do this" },
      { type: "tool_result", toolUseId: "x", content: "ok" },
    ])
    expect(classifyMessage(msg)).toBe("user")
  })
})

describe("classifyMessages", () => {
  it("classifies a batch of messages", () => {
    const records = [
      makeUserRecord("hello"),
      makeAssistantRecord([{ type: "text", text: "hi" }]),
      makeUserRecord("<local-command-stdout>\nout\n</local-command-stdout>"),
    ]
    const classified = classifyMessages(records)
    expect(classified.map((c) => c.category)).toEqual(["user", "assistant", "system"])
  })
})
```

**Step 3: Run test to verify failure**

Run: `cd extractor && npx vitest run src/classifier.test.ts`
Expected: FAIL — module not found

**Step 4: Implement classifier**

Create `extractor/src/classifier.ts`:

```typescript
import type { ClassifiedMessage, MessageCategory, RawJsonlRecord } from "./types"

/** Hard noise tags that should be filtered out entirely */
const HARD_NOISE_TAGS = ["<local-command-caveat>", "<system-reminder>"]

/** Entry types that are always noise */
const NOISE_TYPES = new Set(["system", "summary", "file-history-snapshot", "queue-operation"])

/**
 * Classify a single JSONL record into a message category.
 *
 * Priority cascade (first match wins):
 * 1. hardNoise — system metadata, synthetic messages, noise tags
 * 2. compact — compaction boundary markers
 * 3. system — command output (local-command-stdout/stderr)
 * 4. user — genuine user input (isMeta=false, has text/image content)
 * 5. assistant — everything else (assistant messages, tool results, internal flow)
 */
export function classifyMessage(record: RawJsonlRecord): MessageCategory {
  // 1. Hard noise — filtered out entirely
  if (isHardNoise(record)) return "hardNoise"

  // 2. Compact summary
  if (isCompactMessage(record)) return "compact"

  // 3. System (command output)
  if (isSystemMessage(record)) return "system"

  // 4. User (genuine input)
  if (isUserMessage(record)) return "user"

  // 5. Assistant (catch-all)
  return "assistant"
}

/**
 * Classify a batch of messages.
 */
export function classifyMessages(records: RawJsonlRecord[]): ClassifiedMessage[] {
  return records.map((record) => ({
    record,
    category: classifyMessage(record),
  }))
}

/** Check if record is hard noise (should be excluded from output) */
function isHardNoise(record: RawJsonlRecord): boolean {
  const type = record.type

  // Noise types
  if (NOISE_TYPES.has(type)) return true

  // Sidechain (subagent messages in main session)
  if (record.isSidechain) return true

  const message = record.message
  if (!message) return true

  // Synthetic assistant
  if (type === "assistant" && message.model === "<synthetic>") return true

  // User messages with hard noise tags
  if (type === "user" && !record.isMeta) {
    const content = message.content
    if (typeof content === "string") {
      for (const tag of HARD_NOISE_TAGS) {
        if (content.startsWith(tag)) return true
      }
    }
  }

  // Interruption messages
  if (type === "user" && typeof message.content === "string") {
    if (message.content.includes("[Request interrupted by user]")) return true
  }

  return false
}

/** Check if record is a compaction boundary */
function isCompactMessage(record: RawJsonlRecord): boolean {
  return record.isCompactSummary === true
}

/** Check if record is command output (system chunk) */
function isSystemMessage(record: RawJsonlRecord): boolean {
  if (record.type !== "user" || record.isMeta) return false

  const content = record.message?.content
  if (typeof content === "string") {
    return (
      content.startsWith("<local-command-stdout>") ||
      content.startsWith("<local-command-stderr>")
    )
  }

  return false
}

/** Check if record is genuine user input */
function isUserMessage(record: RawJsonlRecord): boolean {
  if (record.type !== "user") return false
  if (record.isMeta) return false

  const content = record.message?.content
  if (!content) return false

  // String content: must not be system output or hard noise
  if (typeof content === "string") {
    if (content.startsWith("<local-command-stdout>")) return false
    if (content.startsWith("<local-command-stderr>")) return false
    for (const tag of HARD_NOISE_TAGS) {
      if (content.startsWith(tag)) return false
    }
    return content.trim().length > 0
  }

  // Array content: must contain text or image blocks (not just tool_result)
  if (Array.isArray(content)) {
    return content.some(
      (block) =>
        block.type === "text" ||
        block.type === "image" ||
        block.type === "tool_use",
    )
  }

  return false
}
```

**Step 5: Run tests to verify pass**

Run: `cd extractor && npx vitest run src/classifier.test.ts`
Expected: All tests PASS

**Step 6: Integrate classifier into jsonl-parser**

In `extractor/src/jsonl-parser.ts`, replace the `isDisplayableEntry` call with classification:

```typescript
import { classifyMessage } from "./classifier"

// Inside the for-loop, replace:
//   if (!isDisplayableEntry(entry)) continue
// With:
const record = entry as unknown as RawJsonlRecord
const category = classifyMessage(record)
if (category === "hardNoise") continue

rawMessages.push(record)
```

**Step 7: Add category to parsed output**

Extend `JsonlParseResult` in `jsonl-parser.ts`:

```typescript
import type { MessageCategory } from "./types"

export interface JsonlParseResult {
  rawMessages: RawJsonlRecord[]
  categories: MessageCategory[]  // <-- ADD: parallel array of categories
  toolCalls: ToolCall[]
  malformedCount: number
}
```

Collect categories during the parse loop:

```typescript
const categories: MessageCategory[] = []

// In the loop, after classification:
categories.push(category)
```

Return:

```typescript
return { rawMessages: dedupedMessages, categories, toolCalls, malformedCount }
```

**Step 8: Run all extractor tests**

Run: `cd extractor && npx vitest run`
Expected: All tests PASS

**Step 9: Commit**

```bash
git add extractor/src/types.ts extractor/src/classifier.ts extractor/src/classifier.test.ts extractor/src/jsonl-parser.ts extractor/src/noise-filter.ts
git commit -m "feat(extractor): add message classification with 5-category cascade"
```

---

## Phase 2: Rich Data Extraction (HIGH Priority)

### Task 3: Tool Execution Tracking

**Objective:** Extract tool calls with proper linking to results, timing, error detection, and Task/subagent identification.

**Files:**
- Create: `extractor/src/tool-extraction.ts`
- Create: `extractor/src/tool-extraction.test.ts`
- Modify: `extractor/src/types.ts` (extend `ToolCall` type)
- Modify: `extractor/src/jsonl-parser.ts` (use new extraction)

**Step 1: Extend `ToolCall` type in `types.ts`**

```typescript
export interface ToolCall {
  toolUseId: string
  name: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
  timestamp?: string
  // NEW FIELDS:
  isTask: boolean           // true if name === "Task"
  taskDescription?: string  // extracted from Task input
  taskSubagentType?: string // extracted from Task input
}
```

**Step 2: Write failing tests**

Create `extractor/src/tool-extraction.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { extractToolCalls, extractToolResults, linkToolResults } from "./tool-extraction"

describe("extractToolCalls", () => {
  it("extracts tool_use blocks from assistant content", () => {
    const content = [
      { type: "text", text: "Let me check" },
      { type: "tool_use", id: "tc-1", name: "Read", input: { file_path: "/foo.ts" } },
      { type: "tool_use", id: "tc-2", name: "Bash", input: { command: "ls" } },
    ]

    const calls = extractToolCalls(content, "2024-01-01T00:00:00Z")
    expect(calls).toHaveLength(2)
    expect(calls[0].name).toBe("Read")
    expect(calls[0].toolUseId).toBe("tc-1")
    expect(calls[0].isTask).toBe(false)
    expect(calls[1].name).toBe("Bash")
  })

  it("identifies Task calls and extracts description", () => {
    const content = [
      {
        type: "tool_use",
        id: "tc-task",
        name: "Task",
        input: {
          description: "Fix the login bug",
          subagent_type: "leaf",
          prompt: "fix login",
        },
      },
    ]

    const calls = extractToolCalls(content, "2024-01-01T00:00:00Z")
    expect(calls).toHaveLength(1)
    expect(calls[0].isTask).toBe(true)
    expect(calls[0].taskDescription).toBe("Fix the login bug")
    expect(calls[0].taskSubagentType).toBe("leaf")
  })

  it("returns empty array for content without tool_use", () => {
    const content = [{ type: "text", text: "hello" }]
    expect(extractToolCalls(content, "2024-01-01T00:00:00Z")).toHaveLength(0)
  })

  it("handles string content gracefully", () => {
    expect(extractToolCalls("just text", "2024-01-01T00:00:00Z")).toHaveLength(0)
  })
})

describe("extractToolResults", () => {
  it("extracts tool_result blocks from user content", () => {
    const content = [
      { type: "tool_result", toolUseId: "tc-1", content: "file contents here", is_error: false },
      { type: "text", text: "next step" },
    ]

    const results = extractToolResults(content)
    expect(results).toHaveLength(1)
    expect(results[0].toolUseId).toBe("tc-1")
    expect(results[0].isError).toBe(false)
  })

  it("handles is_error boolean", () => {
    const content = [{ type: "tool_result", toolUseId: "tc-1", content: "failed", is_error: true }]
    const results = extractToolResults(content)
    expect(results[0].isError).toBe(true)
  })
})

describe("linkToolResults", () => {
  it("links results to tool calls by toolUseId", () => {
    const calls = [
      { toolUseId: "tc-1", name: "Read", input: {} },
      { toolUseId: "tc-2", name: "Bash", input: {} },
    ]
    const results = [
      { toolUseId: "tc-1", content: "file data", isError: false },
    ]

    linkToolResults(calls, results)
    expect(calls[0].result).toBe("file data")
    expect(calls[0].isError).toBe(false)
    expect(calls[1].result).toBeUndefined()
  })
})
```

**Step 3: Run test to verify failure**

Run: `cd extractor && npx vitest run src/tool-extraction.test.ts`
Expected: FAIL — module not found

**Step 4: Implement tool extraction**

Create `extractor/src/tool-extraction.ts`:

```typescript
import type { ToolCall } from "./types"

interface RawToolResult {
  toolUseId: string
  content: unknown
  isError?: boolean
}

/**
 * Extract tool calls from assistant message content blocks.
 */
export function extractToolCalls(
  content: Array<Record<string, unknown>> | string,
  timestamp?: string,
): ToolCall[] {
  if (typeof content === "string" || !Array.isArray(content)) return []

  const calls: ToolCall[] = []
  for (const block of content) {
    if (block.type !== "tool_use") continue

    const name = String(block.name ?? "")
    const input = (block.input as Record<string, unknown>) ?? {}
    const isTask = name === "Task"

    calls.push({
      toolUseId: String(block.id ?? block.toolUseId ?? ""),
      name,
      input,
      timestamp,
      isTask,
      taskDescription: isTask ? String(input.description ?? "") : undefined,
      taskSubagentType: isTask ? String(input.subagent_type ?? "") : undefined,
    })
  }

  return calls
}

/**
 * Extract tool results from user message content blocks.
 */
export function extractToolResults(
  content: Array<Record<string, unknown>> | string,
): RawToolResult[] {
  if (typeof content === "string" || !Array.isArray(content)) return []

  const results: RawToolResult[] = []
  for (const block of content) {
    if (block.type !== "tool_result") continue
    results.push({
      toolUseId: String(block.toolUseId ?? ""),
      content: block.content ?? "",
      isError: Boolean(block.is_error),
    })
  }

  return results
}

/**
 * Link tool results to tool calls by toolUseId.
 * Mutates the calls array, setting result and isError.
 */
export function linkToolResults(
  calls: ToolCall[],
  results: RawToolResult[],
): void {
  const resultMap = new Map<string, RawToolResult>()
  for (const r of results) {
    resultMap.set(r.toolUseId, r)
  }

  for (const call of calls) {
    const result = resultMap.get(call.toolUseId)
    if (result) {
      call.result = formatToolResult(result.content)
      call.isError = result.isError
    }
  }
}

/**
 * Format tool result content to a readable string.
 */
function formatToolResult(content: unknown): string {
  if (typeof content === "string") return content
  if (content && typeof content === "object") {
    const obj = content as Record<string, unknown>
    if (obj.stdout !== undefined) {
      let s = String(obj.stdout)
      if (obj.stderr) s += `\n[stderr]: ${obj.stderr}`
      return s
    }
    return JSON.stringify(content)
  }
  return String(content ?? "")
}
```

**Step 5: Run tests to verify pass**

Run: `cd extractor && npx vitest run src/tool-extraction.test.ts`
Expected: All tests PASS

**Step 6: Replace extraction logic in `jsonl-parser.ts`**

Replace the inline tool call extraction (lines 54-98) with:

```typescript
import { extractToolCalls, extractToolResults, linkToolResults } from "./tool-extraction"

// In the parse loop, replace the tool extraction block with:
if (record.type === "assistant") {
  const calls = extractToolCalls(record.message?.content ?? [], record.timestamp)
  if (calls.length > 0) {
    toolCalls.push(...calls)
  }
}

// After the main loop, link results from user messages:
for (const record of rawMessages) {
  if (record.type === "user" && record.message?.content) {
    const results = extractToolResults(record.message.content)
    if (results.length > 0) {
      linkToolResults(toolCalls, results)
    }
  }
}
```

**Step 7: Run all tests**

Run: `cd extractor && npx vitest run`
Expected: All tests PASS

**Step 8: Commit**

```bash
git add extractor/src/types.ts extractor/src/tool-extraction.ts extractor/src/tool-extraction.test.ts extractor/src/jsonl-parser.ts
git commit -m "feat(extractor): add structured tool call extraction with Task identification"
```

---

### Task 4: Model Name Parsing

**Objective:** Parse model identifiers from JSONL entries to support multi-model sessions and accurate pricing lookups.

**Files:**
- Create: `extractor/src/model-parser.ts`
- Create: `extractor/src/model-parser.test.ts`

**Step 1: Write failing tests**

Create `extractor/src/model-parser.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { parseModelName, normalizeModelName } from "./model-parser"

describe("parseModelName", () => {
  it("extracts model from full Anthropic model string", () => {
    expect(parseModelName("claude-sonnet-4-20250514")).toBe("claude-sonnet-4")
  })

  it("extracts model from versioned string", () => {
    expect(parseModelName("claude-opus-4-20250514")).toBe("claude-opus-4")
  })

  it("returns raw name if no version suffix", () => {
    expect(parseModelName("claude-sonnet-4")).toBe("claude-sonnet-4")
  })

  it("handles null/undefined", () => {
    expect(parseModelName(null)).toBe("unknown")
    expect(parseModelName(undefined)).toBe("unknown")
    expect(parseModelName("")).toBe("unknown")
  })

  it("strips provider prefix", () => {
    expect(parseModelName("anthropic/claude-sonnet-4")).toBe("claude-sonnet-4")
  })
})

describe("normalizeModelName", () => {
  it("normalizes to pricing key", () => {
    expect(normalizeModelName("claude-sonnet-4-20250514")).toBe("claude-sonnet-4")
  })

  it("keeps known model names", () => {
    expect(normalizeModelName("claude-opus-4")).toBe("claude-opus-4")
  })

  it("normalizes unknown to lowercase", () => {
    expect(normalizeModelName("CLAUDE-SONNET-4")).toBe("claude-sonnet-4")
  })
})
```

**Step 2: Run test to verify failure**

Run: `cd extractor && npx vitest run src/model-parser.test.ts`
Expected: FAIL

**Step 3: Implement model parser**

Create `extractor/src/model-parser.ts`:

```typescript
/**
 * Parse model name from a raw model string.
 * Strips provider prefixes and date suffixes.
 *
 * "claude-sonnet-4-20250514" → "claude-sonnet-4"
 * "anthropic/claude-opus-4-20250514" → "claude-opus-4"
 */
export function parseModelName(raw: string | null | undefined): string {
  if (!raw) return "unknown"

  let name = raw.trim()

  // Strip provider prefix (e.g., "anthropic/")
  const slashIdx = name.lastIndexOf("/")
  if (slashIdx >= 0) {
    name = name.slice(slashIdx + 1)
  }

  // Strip date suffix (e.g., "-20250514")
  const dateMatch = name.match(/^(\w+)-\d{8}$/)
  if (dateMatch) {
    name = dateMatch[1]
  }

  return name.toLowerCase()
}

/**
 * Normalize model name for pricing lookup.
 * Ensures consistent key format.
 */
export function normalizeModelName(raw: string | null | undefined): string {
  return parseModelName(raw)
}
```

**Step 4: Run tests to verify pass**

Run: `cd extractor && npx vitest run src/model-parser.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add extractor/src/model-parser.ts extractor/src/model-parser.test.ts
git commit -m "feat(extractor): add model name parsing for multi-model sessions"
```

---

### Task 5: Enhanced Pricing with Model Detection

**Objective:** Upgrade pricing to use per-message model detection instead of session-level model, supporting mixed-model sessions.

**Files:**
- Modify: `extractor/src/pricing.ts` (use model-parser, per-turn model)
- Modify: `extractor/src/types.ts` (add `model` to `Turn`)

**Step 1: Add `model` field to `Turn` in `types.ts`**

```typescript
export interface Turn {
  timestamp: string
  tokenUsage: TokenUsage
  toolName?: string
  cwd?: string
  messages: Message[]
  toolCalls: ToolCall[]
  cacheWriteType: "5m" | "1h" | "none"
  cacheReadType: "5m" | "1h" | "5m-fallback" | "unknown"
  cacheCreationTokensThisTurn: number
  model?: string  // <-- ADD: model used for this turn's API call
}
```

**Step 2: Update pricing to use per-turn model**

In `extractor/src/pricing.ts`, update `calculateTurnCost`:

```typescript
import { normalizeModelName } from "./model-parser"

function calculateTurnCost(turn: Turn, defaultRate: PricingRate): TurnPricing {
  // Use turn-specific model if available, fall back to session default
  const rate = turn.model
    ? getPricing(normalizeModelName(turn.model))
    : defaultRate

  const inputCost = (turn.tokenUsage.inputTokens / 1_000_000) * rate.inputPerMTok
  const outputCost = (turn.tokenUsage.outputTokens / 1_000_000) * rate.outputPerMTok
  const cacheReadCost = (turn.tokenUsage.cacheReadTokens / 1_000_000) * rate.cacheReadPerMTok
  const cacheCreation5mCost =
    (turn.tokenUsage.cacheCreation5mTokens / 1_000_000) * rate.cacheCreation5mPerMTok
  const cacheCreation1hCost =
    (turn.tokenUsage.cacheCreation1hTokens / 1_000_000) * rate.cacheCreation1hPerMTok
  const totalCost =
    inputCost + outputCost + cacheReadCost + cacheCreation5mCost + cacheCreation1hCost

  return {
    inputCost,
    outputCost,
    cacheReadCost,
    cacheCreation5mCost,
    cacheCreation1hCost,
    totalCost,
  }
}
```

**Step 3: Update merger to pass model to turns**

In `extractor/src/merger.ts`, after matching turns to messages, set the model:

```typescript
// In matchTurnsToMessages, after building normalizedMessages:
const turnModel = matchedMessages.find((m) => m.type === "assistant")?.message?.model

return {
  ...turn,
  model: turnModel ?? turn.model,
  messages: normalizedMessages,
  toolCalls: matchedToolCalls,
  tokenUsage: mergedTokenUsage,
}
```

**Step 4: Run all tests**

Run: `cd extractor && npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add extractor/src/types.ts extractor/src/pricing.ts extractor/src/merger.ts
git commit -m "feat(extractor): add per-turn model detection for accurate pricing"
```

---

## Phase 3: Session Intelligence (MEDIUM Priority)

### Task 6: Subagent Resolution

**Objective:** Discover, parse, and link subagent files to Task calls in the main session, with parallel detection and warmup filtering.

**Files:**
- Create: `extractor/src/subagent-locator.ts`
- Create: `extractor/src/subagent-resolver.ts`
- Create: `extractor/src/subagent-locator.test.ts`
- Create: `extractor/src/subagent-resolver.test.ts`
- Modify: `extractor/src/types.ts` (extend `Subagent` type, add `SubagentFile`)
- Modify: `extractor/src/merger.ts` (integrate subagent resolution)

**Step 1: Extend types in `types.ts`**

```typescript
/** Subagent file metadata */
export interface SubagentFile {
  agentId: string
  filePath: string
  sessionId?: string  // for legacy flat structure
}

/** Subagent session (extended) */
export interface Subagent {
  id: string
  parentTaskId: string        // toolUseId of the Task call that spawned it
  description: string
  startTime: string
  endTime: string
  turnCount: number
  model: string
  totalTokens: TokenUsage
  status: "completed" | "failed" | "pending"
  isParallel: boolean
  messages: RawJsonlRecord[]
  toolCalls: ToolCall[]
}
```

**Step 2: Write failing tests for locator**

Create `extractor/src/subagent-locator.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { hasSubagents, listSubagentFiles, SubagentLocator } from "./subagent-locator"

// NOTE: These tests require filesystem fixtures or mocking
// Mark as integration tests or use tmp directories

describe("SubagentLocator", () => {
  it("finds subagent files in new nested structure", () => {
    // Test with actual filesystem or mocked paths
    // Placeholder — implement with tmp fixtures
    expect(true).toBe(true)
  })
})
```

**Step 3: Implement locator**

Create `extractor/src/subagent-locator.ts`:

```typescript
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { SubagentFile } from "./types"

/**
 * Locate subagent files for a session.
 *
 * Claude Code stores subagent data in two structures:
 * - NEW (nested): {projectsDir}/{encodedProject}/{sessionId}/subagents/agent-{id}.jsonl
 * - OLD (legacy flat): {projectsDir}/{encodedProject}/agent-{id}.jsonl
 */
export function listSubagentFiles(
  projectsDir: string,
  encodedProject: string,
  sessionId: string,
): SubagentFile[] {
  const files: SubagentFile[] = []

  // New nested structure
  const nestedDir = join(projectsDir, encodedProject, sessionId, "subagents")
  if (existsSync(nestedDir)) {
    const entries = readdirSync(nestedDir)
    for (const entry of entries) {
      const match = entry.match(/^agent-(.+)\.jsonl$/)
      if (match) {
        files.push({
          agentId: match[1],
          filePath: join(nestedDir, entry),
        })
      }
    }
  }

  // Legacy flat structure
  const flatDir = join(projectsDir, encodedProject)
  if (existsSync(flatDir)) {
    const entries = readdirSync(flatDir)
    for (const entry of entries) {
      const match = entry.match(/^agent-(.+)\.jsonl$/)
      if (match) {
        const agentId = match[1]
        // Skip if already found in nested structure
        if (files.some((f) => f.agentId === agentId)) continue

        const filePath = join(flatDir, entry)
        // Read first line to check if it belongs to this session
        const firstLine = getFirstLine(filePath)
        if (firstLine) {
          try {
            const parsed = JSON.parse(firstLine)
            if (parsed.sessionId === sessionId || !parsed.sessionId) {
              files.push({ agentId, filePath, sessionId: parsed.sessionId })
            }
          } catch {
            // Include it anyway — we can't verify
            files.push({ agentId, filePath })
          }
        }
      }
    }
  }

  return files
}

/**
 * Check if a session has subagent files.
 */
export function hasSubagents(
  projectsDir: string,
  encodedProject: string,
  sessionId: string,
): boolean {
  const files = listSubagentFiles(projectsDir, encodedProject, sessionId)
  return files.length > 0
}

function getFirstLine(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, "utf-8")
    const firstNewline = content.indexOf("\n")
    return firstNewline >= 0 ? content.slice(0, firstNewline) : content
  } catch {
    return null
  }
}
```

**Step 4: Implement resolver**

Create `extractor/src/subagent-resolver.ts`:

```typescript
import { readFileSync } from "node:fs"
import type { Subagent, SubagentFile, TokenUsage } from "./types"

/**
 * Resolve subagent files into full Subagent objects.
 * Links subagents to Task calls by agentId matching.
 */
export function resolveSubagents(
  subagentFiles: SubagentFile[],
  taskCalls: Array<{ toolUseId: string; taskDescription?: string }>,
): Subagent[] {
  if (subagentFiles.length === 0) return []

  const subagents: Subagent[] = []
  const matchedTaskIds = new Set<string>()

  for (const file of subagentFiles) {
    const parsed = parseSubagentFile(file.filePath)
    if (!parsed) continue

    // Filter warmup subagents
    if (isWarmupSubagent(parsed.messages)) continue

    // Link to Task call by agentId or description
    const linkedTask = linkToTask(file, taskCalls, matchedTaskIds)

    const timing = calculateTiming(parsed.messages)
    const tokens = aggregateTokens(parsed.messages)
    const model = extractModel(parsed.messages)

    subagents.push({
      id: file.agentId,
      parentTaskId: linkedTask?.toolUseId ?? "unknown",
      description: linkedTask?.taskDescription ?? "",
      startTime: timing.start,
      endTime: timing.end,
      turnCount: parsed.messages.filter((m) => m.type === "user" && !m.isMeta).length,
      model,
      totalTokens: tokens,
      status: "completed", // TODO: detect failures
      isParallel: false,   // set later by parallel detection
      messages: parsed.messages,
      toolCalls: parsed.toolCalls,
    })

    if (linkedTask) {
      matchedTaskIds.add(linkedTask.toolUseId)
    }
  }

  // Detect parallel execution (subagents starting within 100ms of each other)
  detectParallelExecution(subagents)

  return subagents
}

interface ParsedSubagent {
  messages: import("./types").RawJsonlRecord[]
  toolCalls: import("./types").ToolCall[]
}

function parseSubagentFile(filePath: string): ParsedSubagent | null {
  try {
    const content = readFileSync(filePath, "utf-8")
    const lines = content.split("\n").filter((l) => l.trim().length > 0)
    const messages: import("./types").RawJsonlRecord[] = []
    const toolCalls: import("./types").ToolCall[] = []

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as import("./types").RawJsonlRecord
        messages.push(entry)

        if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
          for (const block of entry.message.content) {
            if (block.type === "tool_use") {
              toolCalls.push({
                toolUseId: String(block.id ?? ""),
                name: String(block.name ?? ""),
                input: (block.input as Record<string, unknown>) ?? {},
                timestamp: entry.timestamp,
                isTask: block.name === "Task",
              })
            }
          }
        }
      } catch {
        // skip malformed lines
      }
    }

    return { messages, toolCalls }
  } catch {
    return null
  }
}

function isWarmupSubagent(messages: import("./types").RawJsonlRecord[]): boolean {
  const firstUser = messages.find((m) => m.type === "user" && !m.isMeta)
  if (!firstUser) return false
  const content = firstUser.message?.content
  if (typeof content === "string") return content.trim() === "Warmup"
  return false
}

function linkToTask(
  file: SubagentFile,
  taskCalls: Array<{ toolUseId: string; taskDescription?: string }>,
  matchedTaskIds: Set<string>,
): { toolUseId: string; taskDescription?: string } | null {
  // Try matching by description
  for (const task of taskCalls) {
    if (matchedTaskIds.has(task.toolUseId)) continue
    if (task.taskDescription && task.taskDescription.length > 0) {
      return task
    }
  }

  // Positional fallback: first unmatched task
  for (const task of taskCalls) {
    if (!matchedTaskIds.has(task.toolUseId)) return task
  }

  return null
}

function calculateTiming(
  messages: import("./types").RawJsonlRecord[],
): { start: string; end: string } {
  const timestamps = messages
    .map((m) => m.timestamp)
    .filter((t): t is string => Boolean(t))

  if (timestamps.length === 0) {
    return { start: "", end: "" }
  }

  return {
    start: timestamps[0],
    end: timestamps[timestamps.length - 1],
  }
}

function aggregateTokens(messages: import("./types").RawJsonlRecord[]): TokenUsage {
  const totals: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
  }

  const seen = new Set<string>()

  for (const msg of messages) {
    const requestId = msg.requestId
    if (requestId) {
      if (seen.has(requestId)) continue
      seen.add(requestId)
    }

    const usage = msg.message?.usage
    if (usage) {
      totals.inputTokens += usage.input_tokens ?? 0
      totals.outputTokens += usage.output_tokens ?? 0
      totals.cacheReadTokens += usage.cache_read_input_tokens ?? 0
      totals.cacheCreation5mTokens += usage.cacheCreation5mTokens ?? 0
      totals.cacheCreation1hTokens += usage.cacheCreation1hTokens ?? 0
    }
  }

  return totals
}

function extractModel(messages: import("./types").RawJsonlRecord[]): string {
  for (const msg of messages) {
    if (msg.type === "assistant" && msg.message?.model) {
      return msg.message.model
    }
  }
  return "unknown"
}

function detectParallelExecution(subagents: Subagent[]): void {
  const PARALLEL_WINDOW_MS = 100

  // Group by start time within window
  const sorted = [...subagents]
    .filter((s) => s.startTime)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())

  let i = 0
  while (i < sorted.length) {
    const groupStart = new Date(sorted[i].startTime).getTime()
    let j = i + 1

    while (j < sorted.length) {
      const diff = new Date(sorted[j].startTime).getTime() - groupStart
      if (diff <= PARALLEL_WINDOW_MS) {
        j++
      } else {
        break
      }
    }

    // Mark group as parallel if >1 member
    if (j - i > 1) {
      for (let k = i; k < j; k++) {
        sorted[k].isParallel = true
      }
    }

    i = j
  }
}
```

**Step 5: Integrate into merger**

In `extractor/src/merger.ts`, add subagent resolution step:

```typescript
import { listSubagentFiles } from "./subagent-locator"
import { resolveSubagents } from "./subagent-resolver"
import { encodeProjectName } from "./utils"

// In extractFullTimeline, after step 3 (matchTurnsToMessages):

// 3b. Resolve subagents
const encodedProject = encodeProjectName(session.projectName)
const subagentFiles = listSubagentFiles(projectsDir, encodedProject, sessionId)
const taskCalls = matchedTurns.flatMap((t) =>
  t.toolCalls.filter((tc) => tc.isTask).map((tc) => ({
    toolUseId: tc.toolUseId,
    taskDescription: tc.taskDescription,
  })),
)
const subagents = resolveSubagents(subagentFiles, taskCalls)
```

**Step 6: Add subagents to output type**

In `types.ts`, extend `FullTimelineSession`:

```typescript
export interface FullTimelineSession {
  session: SessionMetadata
  turns: Turn[]
  pricing: SessionPricing
  subagents: Subagent[]  // <-- ADD
}
```

**Step 7: Run all tests**

Run: `cd extractor && npx vitest run`
Expected: All tests PASS

**Step 8: Commit**

```bash
git add extractor/src/types.ts extractor/src/subagent-locator.ts extractor/src/subagent-resolver.ts extractor/src/merger.ts
git commit -m "feat(extractor): add subagent resolution with parallel detection"
```

---

### Task 7: Context Window Tracking

**Objective:** Track what consumes tokens in Claude's context window across categories, with compaction-aware phase breakdowns.

**Files:**
- Create: `extractor/src/context-tracker.ts`
- Create: `extractor/src/context-tracker.test.ts`
- Modify: `extractor/src/types.ts` (add context types)

**Step 1: Add context types to `types.ts`**

```typescript
/** Context injection categories */
export type ContextCategory =
  | "claude-md"
  | "mentioned-file"
  | "tool-output"
  | "thinking-text"
  | "user-message"
  | "unknown"

/** A single context injection event */
export interface ContextInjection {
  category: ContextCategory
  tokenCount: number
  timestamp: string
  turnIndex: number
  description?: string  // e.g., file path, tool name
}

/** Aggregated context stats */
export interface ContextStats {
  totalByCategory: Record<ContextCategory, number>
  injections: ContextInjection[]
  phaseCount: number     // number of compaction resets
}

/** Per-turn context snapshot */
export interface TurnContextSnapshot {
  turnIndex: number
  timestamp: string
  accumulatedInput: number     // input tokens up to this turn
  accumulatedCacheRead: number
  injections: ContextInjection[]
}
```

**Step 2: Write failing tests**

Create `extractor/src/context-tracker.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { computeContextStats, detectCompactions } from "./context-tracker"
import type { RawJsonlRecord } from "./types"

describe("detectCompactions", () => {
  it("detects compaction boundaries by isCompactSummary", () => {
    const records: RawJsonlRecord[] = [
      { type: "user", uuid: "1", message: { role: "user", content: "hello" } },
      {
        type: "summary",
        uuid: "2",
        message: { role: "system", content: [] },
        isCompactSummary: true,
      },
      { type: "user", uuid: "3", message: { role: "user", content: "continue" } },
    ]

    const phases = detectCompactions(records)
    expect(phases).toHaveLength(2) // 2 phases (1 compaction)
    expect(phases[0].startIndex).toBe(0)
    expect(phases[0].endIndex).toBe(1)
    expect(phases[1].startIndex).toBe(2)
  })

  it("returns single phase when no compactions", () => {
    const records: RawJsonlRecord[] = [
      { type: "user", uuid: "1", message: { role: "user", content: "hello" } },
      { type: "assistant", uuid: "2", message: { role: "assistant", content: [] } },
    ]

    const phases = detectCompactions(records)
    expect(phases).toHaveLength(1)
  })
})

describe("computeContextStats", () => {
  it("accumulates token usage across turns", () => {
    const records: RawJsonlRecord[] = [
      {
        type: "user",
        uuid: "1",
        timestamp: "2024-01-01T00:00:00Z",
        message: {
          role: "user",
          content: "hello",
          usage: { input_tokens: 1000, output_tokens: 50 },
        },
      },
      {
        type: "assistant",
        uuid: "2",
        timestamp: "2024-01-01T00:00:01Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hi" }],
          usage: { input_tokens: 1050, output_tokens: 200 },
        },
      },
    ]

    const stats = computeContextStats(records)
    expect(stats.phaseCount).toBe(1)
    expect(stats.injections.length).toBeGreaterThan(0)
  })
})
```

**Step 3: Run test to verify failure**

Run: `cd extractor && npx vitest run src/context-tracker.test.ts`
Expected: FAIL

**Step 4: Implement context tracker**

Create `extractor/src/context-tracker.ts`:

```typescript
import type {
  ContextCategory,
  ContextInjection,
  ContextStats,
  RawJsonlRecord,
} from "./types"

interface Phase {
  startIndex: number
  endIndex: number
}

/**
 * Detect compaction phases in a message sequence.
 * Each compaction resets accumulated context.
 */
export function detectCompactions(records: RawJsonlRecord[]): Phase[] {
  const phases: Phase[] = []
  let phaseStart = 0

  for (let i = 0; i < records.length; i++) {
    if (records[i].isCompactSummary) {
      phases.push({ startIndex: phaseStart, endIndex: i })
      phaseStart = i + 1
    }
  }

  // Final phase
  if (phaseStart < records.length) {
    phases.push({ startIndex: phaseStart, endIndex: records.length - 1 })
  }

  return phases
}

/**
 * Compute context window statistics across a session.
 * Tracks token consumption by category with compaction awareness.
 */
export function computeContextStats(records: RawJsonlRecord[]): ContextStats {
  const phases = detectCompactions(records)
  const injections: ContextInjection[] = []

  const totalByCategory: Record<ContextCategory, number> = {
    "claude-md": 0,
    "mentioned-file": 0,
    "tool-output": 0,
    "thinking-text": 0,
    "user-message": 0,
    unknown: 0,
  }

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    const usage = record.message?.usage
    if (!usage) continue

    const inputTokens = usage.input_tokens ?? 0
    if (inputTokens === 0) continue

    const timestamp = record.timestamp ?? ""
    const category = categorizeContext(record)

    // Estimate category breakdown from input tokens
    const estimatedTokens = estimateCategoryTokens(record, inputTokens)

    if (estimatedTokens > 0) {
      injections.push({
        category,
        tokenCount: estimatedTokens,
        timestamp,
        turnIndex: i,
        description: describeInjection(record, category),
      })
      totalByCategory[category] += estimatedTokens
    }
  }

  return {
    totalByCategory,
    injections,
    phaseCount: phases.length,
  }
}

function categorizeContext(record: RawJsonlRecord): ContextCategory {
  const type = record.type

  if (type === "assistant") {
    // Assistant messages contribute tool output and thinking
    const content = record.message?.content
    if (Array.isArray(content)) {
      const hasToolUse = content.some((b) => b.type === "tool_use")
      const hasThinking = content.some((b) => b.type === "thinking")
      if (hasToolUse) return "tool-output"
      if (hasThinking) return "thinking-text"
    }
    return "unknown"
  }

  if (type === "user") {
    const content = record.message?.content
    if (typeof content === "string") {
      if (content.includes("<command-name>")) return "unknown"
      return "user-message"
    }
    if (Array.isArray(content)) {
      // Tool results are tool-output
      const hasToolResult = content.some((b) => b.type === "tool_result")
      if (hasToolResult && record.isMeta) return "tool-output"
      return "user-message"
    }
  }

  return "unknown"
}

function estimateCategoryTokens(record: RawJsonlRecord, inputTokens: number): number {
  // For now, attribute full input_tokens to the primary category
  // A more precise breakdown would require analyzing content sizes
  return inputTokens
}

function describeInjection(
  record: RawJsonlRecord,
  category: ContextCategory,
): string | undefined {
  if (category === "tool-output") {
    const content = record.message?.content
    if (Array.isArray(content)) {
      const toolUse = content.find((b) => b.type === "tool_use")
      if (toolUse) return String(toolUse.name ?? "unknown")
    }
  }
  return undefined
}
```

**Step 5: Run tests to verify pass**

Run: `cd extractor && npx vitest run src/context-tracker.test.ts`
Expected: All tests PASS

**Step 6: Integrate into merger**

In `extractor/src/merger.ts`, add context stats to output:

```typescript
import { computeContextStats } from "./context-tracker"

// In extractFullTimeline, before return:
const contextStats = computeContextStats(jsonlResult?.rawMessages ?? [])
```

**Step 7: Add context stats to output type**

```typescript
export interface FullTimelineSession {
  session: SessionMetadata
  turns: Turn[]
  pricing: SessionPricing
  subagents: Subagent[]
  context: ContextStats  // <-- ADD
}
```

**Step 8: Run all tests**

Run: `cd extractor && npx vitest run`
Expected: All tests PASS

**Step 9: Commit**

```bash
git add extractor/src/types.ts extractor/src/context-tracker.ts extractor/src/context-tracker.test.ts extractor/src/merger.ts
git commit -m "feat(extractor): add context window tracking with compaction phases"
```

---

### Task 8: Conversation Groups

**Objective:** Group turns into natural user↔AI exchange units for timeline visualization.

**Files:**
- Create: `extractor/src/conversation-groups.ts`
- Create: `extractor/src/conversation-groups.test.ts`
- Modify: `extractor/src/types.ts` (add `ConversationGroup`)

**Step 1: Add conversation group type to `types.ts`**

```typescript
/** A natural user↔AI exchange unit */
export interface ConversationGroup {
  id: string
  startIndex: number      // index in turns array
  endIndex: number        // inclusive
  userMessage?: Turn      // the user's message turn
  aiResponses: Turn[]     // all AI response turns
  toolExecutions: ToolExecution[]
  processIds: string[]    // subagent IDs spawned in this group
  startTime: string
  endTime: string
  totalTokens: TokenUsage
  totalCost: number
}
```

**Step 2: Write failing tests**

Create `extractor/src/conversation-groups.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { buildConversationGroups } from "./conversation-groups"
import type { Turn } from "./types"

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    timestamp: "2024-01-01T00:00:00Z",
    tokenUsage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0 },
    messages: [],
    toolCalls: [],
    cacheWriteType: "none",
    cacheReadType: "unknown",
    cacheCreationTokensThisTurn: 0,
    ...overrides,
  }
}

describe("buildConversationGroups", () => {
  it("groups a simple user→ai exchange", () => {
    const turns = [
      makeTurn({ timestamp: "2024-01-01T00:00:00Z", messages: [{ type: "user", content: [{ type: "text", text: "hello" }] }] }),
      makeTurn({ timestamp: "2024-01-01T00:00:01Z", messages: [{ type: "assistant", content: [{ type: "text", text: "hi" }] }] }),
    ]

    const groups = buildConversationGroups(turns)
    expect(groups).toHaveLength(1)
    expect(groups[0].userMessage).toBeDefined()
    expect(groups[0].aiResponses).toHaveLength(1)
  })

  it("groups multiple AI responses after one user message", () => {
    const turns = [
      makeTurn({ timestamp: "2024-01-01T00:00:00Z", messages: [{ type: "user", content: [{ type: "text", text: "fix it" }] }] }),
      makeTurn({ timestamp: "2024-01-01T00:00:01Z", messages: [{ type: "assistant", content: [{ type: "text", text: "thinking..." }] }] }),
      makeTurn({ timestamp: "2024-01-01T00:00:02Z", messages: [{ type: "assistant", content: [{ type: "text", text: "done!" }] }] }),
    ]

    const groups = buildConversationGroups(turns)
    expect(groups).toHaveLength(1)
    expect(groups[0].aiResponses).toHaveLength(2)
  })

  it("creates new group for next user message", () => {
    const turns = [
      makeTurn({ timestamp: "2024-01-01T00:00:00Z", messages: [{ type: "user", content: [{ type: "text", text: "first" }] }] }),
      makeTurn({ timestamp: "2024-01-01T00:00:01Z", messages: [{ type: "assistant", content: [{ type: "text", text: "ok" }] }] }),
      makeTurn({ timestamp: "2024-01-01T00:00:02Z", messages: [{ type: "user", content: [{ type: "text", text: "second" }] }] }),
      makeTurn({ timestamp: "2024-01-01T00:00:03Z", messages: [{ type: "assistant", content: [{ type: "text", text: "done" }] }] }),
    ]

    const groups = buildConversationGroups(turns)
    expect(groups).toHaveLength(2)
  })
})
```

**Step 3: Run test to verify failure**

Run: `cd extractor && npx vitest run src/conversation-groups.test.ts`
Expected: FAIL

**Step 4: Implement conversation groups**

Create `extractor/src/conversation-groups.ts`:

```typescript
import type { ConversationGroup, ToolExecution, Turn, TokenUsage } from "./types"

let groupIdCounter = 0

/**
 * Build conversation groups from turns.
 * Each group starts with a user message and contains all subsequent AI responses
 * until the next user message.
 */
export function buildConversationGroups(turns: Turn[]): ConversationGroup[] {
  const groups: ConversationGroup[] = []
  let currentGroup: Partial<ConversationGroup> | null = null

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]
    const isUserTurn = turn.messages.some((m) => m.type === "user")
    const isAiTurn = turn.messages.some((m) => m.type === "assistant")

    if (isUserTurn) {
      // Start a new group
      if (currentGroup) {
        finalizeGroup(currentGroup, groups)
      }
      currentGroup = {
        id: `group-${++groupIdCounter}`,
        startIndex: i,
        userMessage: turn,
        aiResponses: [],
        toolExecutions: [],
        processIds: [],
        startTime: turn.timestamp,
      }
    } else if (isAiTurn && currentGroup) {
      // Add to current group
      currentGroup.aiResponses!.push(turn)
      currentGroup.endIndex = i
      currentGroup.endTime = turn.timestamp

      // Extract tool executions
      for (const tc of turn.toolCalls) {
        const execution: ToolExecution = {
          toolCall: tc,
          result: tc.result,
          isError: tc.isError,
          durationMs: 0, // TODO: compute from timestamps
          startTime: tc.timestamp ?? turn.timestamp,
          endTime: tc.timestamp ?? turn.timestamp,
        }
        currentGroup.toolExecutions!.push(execution)

        if (tc.isTask && tc.taskDescription) {
          currentGroup.processIds!.push(tc.toolUseId)
        }
      }
    }
  }

  // Finalize last group
  if (currentGroup) {
    finalizeGroup(currentGroup, groups)
  }

  return groups
}

function finalizeGroup(
  partial: Partial<ConversationGroup>,
  groups: ConversationGroup[],
): void {
  if (partial.id === undefined) return

  const allTurns = [
    ...(partial.userMessage ? [partial.userMessage] : []),
    ...(partial.aiResponses ?? []),
  ]

  const totalTokens: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
  }

  for (const turn of allTurns) {
    totalTokens.inputTokens += turn.tokenUsage.inputTokens
    totalTokens.outputTokens += turn.tokenUsage.outputTokens
    totalTokens.cacheReadTokens += turn.tokenUsage.cacheReadTokens
    totalTokens.cacheCreation5mTokens += turn.tokenUsage.cacheCreation5mTokens
    totalTokens.cacheCreation1hTokens += turn.tokenUsage.cacheCreation1hTokens
  }

  groups.push({
    id: partial.id,
    startIndex: partial.startIndex ?? 0,
    endIndex: partial.endIndex ?? partial.startIndex ?? 0,
    userMessage: partial.userMessage,
    aiResponses: partial.aiResponses ?? [],
    toolExecutions: partial.toolExecutions ?? [],
    processIds: partial.processIds ?? [],
    startTime: partial.startTime ?? "",
    endTime: partial.endTime ?? partial.startTime ?? "",
    totalTokens,
    totalCost: 0, // computed by pricing module
  })
}
```

**Step 5: Run tests to verify pass**

Run: `cd extractor && npx vitest run src/conversation-groups.test.ts`
Expected: All tests PASS

**Step 6: Add groups to output and integrate**

```typescript
// In types.ts, add to FullTimelineSession:
export interface FullTimelineSession {
  session: SessionMetadata
  turns: Turn[]
  pricing: SessionPricing
  subagents: Subagent[]
  context: ContextStats
  conversationGroups: ConversationGroup[]  // <-- ADD
}

// In merger.ts:
import { buildConversationGroups } from "./conversation-groups"

// In extractFullTimeline:
const conversationGroups = buildConversationGroups(enrichedTurns)
```

**Step 7: Run all tests**

Run: `cd extractor && npx vitest run`
Expected: All tests PASS

**Step 8: Commit**

```bash
git add extractor/src/types.ts extractor/src/conversation-groups.ts extractor/src/conversation-groups.test.ts extractor/src/merger.ts
git commit -m "feat(extractor): add conversation group extraction"
```

---

## Phase 4: Session Intelligence (LOW Priority)

### Task 9: Session State Detection

**Objective:** Detect whether a session is ongoing (AI still working) vs completed, using activity vs ending event analysis.

**Files:**
- Create: `extractor/src/session-state.ts`
- Create: `extractor/src/session-state.test.ts`
- Modify: `extractor/src/types.ts` (add `isOngoing` to `SessionMetadata`)

**Step 1: Add `isOngoing` to `SessionMetadata`**

```typescript
export interface SessionMetadata {
  // ... existing fields
  isOngoing: boolean  // <-- ADD
}
```

**Step 2: Write failing tests**

Create `extractor/src/session-state.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { detectSessionState } from "./session-state"
import type { RawJsonlRecord } from "./types"

describe("detectSessionState", () => {
  it("detects completed session (text output at end)", () => {
    const records: RawJsonlRecord[] = [
      { type: "user", uuid: "1", message: { role: "user", content: "hello" } },
      {
        type: "assistant",
        uuid: "2",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done!" }],
        },
      },
    ]
    expect(detectSessionState(records)).toBe(false)
  })

  it("detects ongoing session (tool_use at end, no text output)", () => {
    const records: RawJsonlRecord[] = [
      { type: "user", uuid: "1", message: { role: "user", content: "hello" } },
      {
        type: "assistant",
        uuid: "2",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "tc-1", name: "Bash", input: {} }],
        },
      },
    ]
    expect(detectSessionState(records)).toBe(true)
  })

  it("detects completed session after interruption", () => {
    const records: RawJsonlRecord[] = [
      { type: "user", uuid: "1", message: { role: "user", content: "hello" } },
      { type: "user", uuid: "2", message: { role: "user", content: "[Request interrupted by user]" } },
    ]
    expect(detectSessionState(records)).toBe(false)
  })

  it("returns false for empty records", () => {
    expect(detectSessionState([])).toBe(false)
  })
})
```

**Step 3: Run test to verify failure**

Run: `cd extractor && npx vitest run src/session-state.test.ts`
Expected: FAIL

**Step 4: Implement session state detection**

Create `extractor/src/session-state.ts`:

```typescript
import type { RawJsonlRecord } from "./types"

type ActivityType = "text_output" | "thinking" | "tool_use" | "tool_result" | "interruption"

interface Activity {
  type: ActivityType
  index: number
}

/**
 * Detect if a session is ongoing (AI still working).
 *
 * Strategy: Find the last "ending" event. If AI activities exist after it,
 * the session is ongoing.
 *
 * Ending events: text output, interruption, exit_plan_mode
 * AI activities: thinking, tool_use, tool_result
 */
export function detectSessionState(records: RawJsonlRecord[]): boolean {
  if (records.length === 0) return false

  const activities: Activity[] = []

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    const activity = classifyActivity(record)
    if (activity) {
      activities.push({ type: activity, index: i })
    }
  }

  if (activities.length === 0) return false

  // Find last ending event
  const endingTypes: ActivityType[] = ["text_output", "interruption"]
  let lastEndingIndex = -1

  for (let i = activities.length - 1; i >= 0; i--) {
    if (endingTypes.includes(activities[i].type)) {
      lastEndingIndex = activities[i].index
      break
    }
  }

  // If no ending event found, session is ongoing
  if (lastEndingIndex === -1) return true

  // Check for AI activities after the last ending event
  const aiTypes: ActivityType[] = ["thinking", "tool_use", "tool_result"]
  for (const activity of activities) {
    if (activity.index > lastEndingIndex && aiTypes.includes(activity.type)) {
      return true
    }
  }

  return false
}

function classifyActivity(record: RawJsonlRecord): ActivityType | null {
  const type = record.type
  const content = record.message?.content

  if (type === "user") {
    // Interruption
    if (typeof content === "string" && content.includes("[Request interrupted by user]")) {
      return "interruption"
    }
    // Tool result
    if (record.isMeta && Array.isArray(content)) {
      const hasToolResult = content.some((b) => b.type === "tool_result")
      if (hasToolResult) return "tool_result"
    }
    return null
  }

  if (type === "assistant" && Array.isArray(content)) {
    const hasText = content.some((b) => b.type === "text" && b.text?.trim())
    const hasToolUse = content.some((b) => b.type === "tool_use")
    const hasThinking = content.some((b) => b.type === "thinking")

    if (hasText) return "text_output"
    if (hasToolUse) return "tool_use"
    if (hasThinking) return "thinking"
  }

  return null
}
```

**Step 5: Run tests to verify pass**

Run: `cd extractor && npx vitest run src/session-state.test.ts`
Expected: All tests PASS

**Step 6: Integrate into merger**

```typescript
import { detectSessionState } from "./session-state"

// In extractFullTimeline:
const isOngoing = detectSessionState(jsonlResult?.rawMessages ?? [])

return {
  session: { ...session, commandExecuted, isOngoing },
  // ...
}
```

**Step 7: Run all tests**

Run: `cd extractor && npx vitest run`
Expected: All tests PASS

**Step 8: Commit**

```bash
git add extractor/src/types.ts extractor/src/session-state.ts extractor/src/session-state.test.ts extractor/src/merger.ts
git commit -m "feat(extractor): add session state detection (ongoing vs completed)"
```

---

### Task 10: Package Exports Map

**Objective:** Add proper `exports` map to `package.json` for direct submodule imports without barrel files.

**Files:**
- Modify: `extractor/package.json`

**Step 1: Add exports map**

```json
{
  "name": "@timeline/extractor",
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types.ts",
    "./dedup": "./src/dedup.ts",
    "./classifier": "./src/classifier.ts",
    "./tool-extraction": "./src/tool-extraction.ts",
    "./model-parser": "./src/model-parser.ts",
    "./pricing": "./src/pricing.ts",
    "./context-tracker": "./src/context-tracker.ts",
    "./conversation-groups": "./src/conversation-groups.ts",
    "./session-state": "./src/session-state.ts",
    "./subagent-locator": "./src/subagent-locator.ts",
    "./subagent-resolver": "./src/subagent-resolver.ts",
    "./db-reader": "./src/db-reader.ts",
    "./merger": "./src/merger.ts",
    "./utils": "./src/utils.ts"
  }
}
```

**Step 2: Verify typecheck passes**

Run: `cd extractor && pnpm typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add extractor/package.json
git commit -m "chore(extractor): add package exports map for submodule imports"
```

---

## Summary

| Phase | Task | Module | Priority | Depends On |
|-------|------|--------|----------|------------|
| 1 | 1 | `dedup.ts` | HIGH | — |
| 1 | 2 | `classifier.ts` | HIGH | — |
| 2 | 3 | `tool-extraction.ts` | HIGH | Task 2 |
| 2 | 4 | `model-parser.ts` | HIGH | — |
| 2 | 5 | `pricing.ts` (upgrade) | HIGH | Task 4 |
| 3 | 6 | `subagent-locator.ts` + `subagent-resolver.ts` | MEDIUM | Task 3 |
| 3 | 7 | `context-tracker.ts` | MEDIUM | Task 2 |
| 3 | 8 | `conversation-groups.ts` | MEDIUM | Task 3 |
| 4 | 9 | `session-state.ts` | LOW | Task 2 |
| 4 | 10 | `package.json` (exports) | LOW | All |

**New files created:** 12 (8 modules + 4 test files)
**Files modified:** 5 (types.ts, jsonl-parser.ts, pricing.ts, merger.ts, package.json)
**New dependencies:** 0
