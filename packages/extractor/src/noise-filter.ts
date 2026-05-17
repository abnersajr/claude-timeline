/** Hard noise tags that should be filtered out entirely */
const HARD_NOISE_TAGS = ["<local-command-caveat>", "<system-reminder>"]

/** Tags that represent command output (keep these) */
const COMMAND_OUTPUT_TAGS = ["<local-command-stdout>", "<local-command-stderr>"]

/** Entry types that are always noise */
const NOISE_TYPES = new Set(["system", "summary", "file-history-snapshot", "queue-operation", "attachment", "last-prompt", "permission-mode"])

/**
 * Check if a JSONL entry should be displayed/processed.
 * Returns false for noise entries, true for real messages.
 */
export function isDisplayableEntry(entry: Record<string, unknown>): boolean {
  // Must have uuid
  if (!entry.uuid) return false

  const type = entry.type as string

  // Filter noise types
  if (NOISE_TYPES.has(type)) return false

  // Filter sidechain messages (subagent)
  if (entry.isSidechain) return false

  const message = entry.message as Record<string, unknown> | undefined
  if (!message) return false

  // Filter synthetic assistant messages
  if (type === "assistant" && message.model === "<synthetic>") return false

  // For user messages, check content for hard noise
  if (type === "user") {
    // Meta messages (tool results) are always kept
    if (entry.isMeta) return true

    const content = message.content
    if (typeof content === "string") {
      // Check for hard noise tags
      for (const tag of HARD_NOISE_TAGS) {
        if (content.startsWith(tag)) return false
      }
      // Check for command output tags (keep these)
      for (const tag of COMMAND_OUTPUT_TAGS) {
        if (content.startsWith(tag)) return true
      }
    }
  }

  return true
}
