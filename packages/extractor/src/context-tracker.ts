import type {
  ContextCategory,
  ContextInjection,
  ContextStats,
  Phase,
  RawJsonlRecord,
  TurnContextSnapshot,
} from "./types.js"

// ─── Content Block Helpers ───────────────────────────────────────────

/** Check if content blocks contain any tool_use blocks */
function hasToolUseBlocks(content: Array<Record<string, unknown>> | string | undefined): boolean {
  if (!Array.isArray(content)) return false
  return content.some((block) => block.type === "tool_use")
}

/** Check if content blocks contain any thinking blocks */
function hasThinkingBlocks(content: Array<Record<string, unknown>> | string | undefined): boolean {
  if (!Array.isArray(content)) return false
  return content.some((block) => block.type === "thinking")
}

// ─── Context Categorization ──────────────────────────────────────────

/**
 * Classify a record's context contribution based on type and content blocks.
 *
 * Priority order:
 * 1. Compact records → "compact"
 * 2. User meta messages with tool_result blocks → "tool-output"
 * 3. User text/image messages → "user-message"
 * 4. Assistant messages with tool_use → "tool-output"
 * 5. Assistant messages with thinking → "thinking-text"
 * 6. System messages (command output) → "system"
 * 7. Everything else → "other"
 */
export function categorizeContext(record: RawJsonlRecord): ContextCategory {
  // 1. Compact summary records
  if (record.isCompactSummary) return "compact"

  // 2. User meta messages with tool_result blocks → tool-output
  if (record.type === "user" && record.isMeta) {
    return "tool-output"
  }

  // 3. User text/image messages → user-message
  if (record.type === "user") {
    return "user-message"
  }

  // 4. Assistant messages with tool_use blocks → tool-output
  if (record.type === "assistant") {
    const content = record.message?.content
    if (hasToolUseBlocks(content)) return "tool-output"

    // 5. Assistant messages with thinking blocks → thinking-text
    if (hasThinkingBlocks(content)) return "thinking-text"
  }

  // 6. System messages → system
  if (record.type === "system") return "system"

  // 7. Fallback
  return "other"
}

// ─── Token Estimation ────────────────────────────────────────────────

/**
 * Extract input tokens from a record's usage data.
 * Returns 0 if no usage data is present.
 */
export function getInputTokens(record: RawJsonlRecord): number {
  return record.message?.usage?.input_tokens ?? 0
}

// ─── Compaction Detection ────────────────────────────────────────────

/**
 * Scan records for isCompactSummary events and return Phase[].
 * Each phase represents a contiguous segment of records between compact events.
 * Phase 1 starts at index 0. The compact record itself is included at the end
 * of the phase it terminates. A new phase starts after each compact record.
 */
export function detectCompactions(records: RawJsonlRecord[]): Phase[] {
  const phases: Phase[] = []
  let currentPhaseNumber = 1
  let currentPhaseStart = 0

  for (let i = 0; i < records.length; i++) {
    if (records[i].isCompactSummary) {
      // End current phase at this compact record (inclusive)
      phases.push({
        phaseNumber: currentPhaseNumber,
        startRecordIndex: currentPhaseStart,
        endRecordIndex: i,
      })
      currentPhaseNumber++
      currentPhaseStart = i + 1
    }
  }

  // Close the final phase (even if empty)
  phases.push({
    phaseNumber: currentPhaseNumber,
    startRecordIndex: currentPhaseStart,
    endRecordIndex: records.length - 1,
  })

  return phases
}

// ─── Phase Lookup ────────────────────────────────────────────────────

/**
 * Determine which phase a record index belongs to.
 */
export function getPhaseForIndex(recordIndex: number, phases: Phase[]): number {
  for (const phase of phases) {
    if (recordIndex >= phase.startRecordIndex && recordIndex <= phase.endRecordIndex) {
      return phase.phaseNumber
    }
  }
  // Fallback: return the last phase
  return phases.length > 0 ? phases[phases.length - 1].phaseNumber : 1
}

// ─── Context Stats Computation ───────────────────────────────────────

/**
 * Compute context statistics by iterating records and categorizing each one.
 * Tracks compaction phases and accumulates tokens by category.
 *
 * For now, attributes full input_tokens to the primary category of each record.
 * Precise per-category breakdown would require content size analysis.
 */
export function computeContextStats(records: RawJsonlRecord[]): ContextStats {
  const phases = detectCompactions(records)

  const tokensByCategory: Record<ContextCategory, number> = {
    "user-message": 0,
    "tool-output": 0,
    "thinking-text": 0,
    system: 0,
    compact: 0,
    other: 0,
  }

  const injections: ContextInjection[] = []
  let totalInputTokens = 0

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    const category = categorizeContext(record)
    const inputTokens = getInputTokens(record)

    const phaseNumber = getPhaseForIndex(i, phases)

    if (inputTokens > 0) {
      tokensByCategory[category] += inputTokens
      totalInputTokens += inputTokens
    }

    injections.push({
      recordIndex: i,
      category,
      inputTokens,
      timestamp: record.timestamp,
      phaseNumber,
    })
  }

  return {
    injections,
    tokensByCategory,
    totalInputTokens,
    phaseCount: phases.length,
    phases,
  }
}

// ─── Turn Context Snapshots ──────────────────────────────────────────

/**
 * Convert context stats into per-turn snapshots for UI consumption.
 * Each snapshot represents a single record's context contribution.
 */
export function getTurnSnapshots(stats: ContextStats): TurnContextSnapshot[] {
  return stats.injections.map((inj) => ({
    recordIndex: inj.recordIndex,
    category: inj.category,
    inputTokens: inj.inputTokens,
    phaseNumber: inj.phaseNumber,
    timestamp: inj.timestamp,
  }))
}
