import type { RawJsonlRecord } from "./types"

/**
 * Deduplicate streaming assistant entries by requestId.
 *
 * Claude Code writes multiple JSONL entries per API response during streaming,
 * each with the same requestId but incrementally increasing output_tokens.
 * Only the entry with the highest output_tokens per requestId is kept.
 *
 * Entries without a requestId (user, system, tool results) pass through unchanged.
 * Returns a new array with only the last entry per requestId kept.
 */
export function deduplicateByRequestId(records: RawJsonlRecord[]): RawJsonlRecord[] {
  // Map from requestId -> { index, outputTokens } of the best entry so far
  const bestByRequestId = new Map<
    string,
    { index: number; outputTokens: number }
  >()

  for (let i = 0; i < records.length; i++) {
    const rid = records[i].requestId
    if (!rid) continue

    const outputTokens = records[i].message?.usage?.output_tokens ?? 0
    const existing = bestByRequestId.get(rid)

    if (!existing || outputTokens > existing.outputTokens) {
      bestByRequestId.set(rid, { index: i, outputTokens })
    }
  }

  // If no requestIds found, no dedup needed
  if (bestByRequestId.size === 0) {
    return records
  }

  // Build set of indices to keep
  const keepIndices = new Set<number>()
  for (const { index } of bestByRequestId.values()) {
    keepIndices.add(index)
  }

  // Also keep all entries without a requestId
  return records.filter((rec, i) => !rec.requestId || keepIndices.has(i))
}
