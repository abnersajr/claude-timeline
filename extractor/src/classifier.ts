import type { ClassifiedMessage, MessageCategory, RawJsonlRecord } from "./types"

/** Entry types that are always noise */
const NOISE_TYPES = new Set(["system", "summary", "file-history-snapshot", "queue-operation"])

/** Hard noise tags that should be filtered out entirely */
const HARD_NOISE_TAGS = ["<local-command-caveat>", "<system-reminder>"]

/** Command output tags that map to system category */
const COMMAND_OUTPUT_TAGS = ["<local-command-stdout>", "<local-command-stderr>"]

/** Check if content string starts with any of the given tags */
function startsWithTag(content: string, tags: readonly string[]): boolean {
  for (const tag of tags) {
    if (content.startsWith(tag)) return true
  }
  return false
}

/** Check if the content array has at least one text or image block */
function hasTextOrImageContent(
  content: Array<Record<string, unknown>> | string,
): boolean {
  if (typeof content === "string") return content.length > 0
  return content.some((block) => block.type === "text" || block.type === "image")
}

// ─── Type guard functions ───────────────────────────────────────────

/**
 * Hard noise: system/summary/file-history-snapshot/queue-operation types,
 * sidechain, synthetic assistant, hard noise tags, interruptions.
 */
export function isHardNoise(record: RawJsonlRecord): boolean {
  const type = record.type

  // Noise entry types
  if (NOISE_TYPES.has(type)) return true

  // Sidechain (subagent) messages
  if (record.isSidechain) return true

  const message = record.message

  // Synthetic assistant messages
  if (type === "assistant" && message?.model === "<synthetic>") return true

  // User messages: check content for hard noise tags and interruptions
  if (type === "user" && message?.content !== undefined) {
    const { content } = message
    if (typeof content === "string") {
      if (startsWithTag(content, HARD_NOISE_TAGS)) return true
      if (content === "[Request interrupted by user]") return true
    }
  }

  return false
}

/** Compact messages are marked by isCompactSummary flag */
export function isCompactMessage(record: RawJsonlRecord): boolean {
  return record.isCompactSummary === true
}

/**
 * System messages: user-type messages that contain command output
 * (local-command-stdout/stderr). These arrive as type="user" in JSONL
 * but represent command output, not user input.
 */
export function isSystemMessage(record: RawJsonlRecord): boolean {
  if (record.type !== "user") return false
  const content = record.message?.content
  if (typeof content !== "string") return false
  return startsWithTag(content, COMMAND_OUTPUT_TAGS)
}

/**
 * User messages: type=user, isMeta=false, has text/image content
 * (not just tool_result blocks). Meta messages (tool results) are
 * classified as assistant because they represent assistant context.
 */
export function isUserMessage(record: RawJsonlRecord): boolean {
  if (record.type !== "user") return false
  if (record.isMeta) return false

  const content = record.message?.content
  if (content === undefined) return false

  // String content is always user text
  if (typeof content === "string") return true

  // Array content: must have at least one text or image block
  return hasTextOrImageContent(content)
}

// ─── Classification functions ───────────────────────────────────────

/**
 * Classify a single JSONL record into a category using the priority cascade:
 * 1. hardNoise — noise types, sidechain, synthetic, hard noise tags, interruptions
 * 2. compact — isCompactSummary === true
 * 3. system — user messages with command output (local-command-stdout/stderr)
 * 4. user — type=user, not meta, has text/image content
 * 5. assistant — everything else (catch-all)
 */
export function classifyMessage(record: RawJsonlRecord): MessageCategory {
  if (isHardNoise(record)) return "hardNoise"
  if (isCompactMessage(record)) return "compact"
  if (isSystemMessage(record)) return "system"
  if (isUserMessage(record)) return "user"
  return "assistant"
}

/**
 * Classify an array of messages, returning ClassifiedMessage objects
 * that pair each record with its category.
 */
export function classifyMessages(records: RawJsonlRecord[]): ClassifiedMessage[] {
  return records.map((record) => ({
    record,
    category: classifyMessage(record),
  }))
}
