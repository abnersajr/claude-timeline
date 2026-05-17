import type { RawJsonlRecord } from "./types"

/**
 * Deduplicate streaming assistant entries by requestId.
 *
 * Claude Code writes multiple JSONL entries per API response during streaming:
 * - Streaming duplicates: same requestId with incrementally increasing output_tokens
 * - Content blocks: same requestId with identical output_tokens (thinking/text/tool_use)
 *
 * Strategy:
 * 1. For streaming duplicates (strictly increasing tokens): keep only the last entry
 * 2. For content blocks (equal tokens): MERGE into one record by concatenating content arrays
 *
 * Entries without a requestId (user, system, tool results) pass through unchanged.
 */
export function deduplicateByRequestId(records: RawJsonlRecord[]): RawJsonlRecord[] {
  // Map from requestId -> merged entry info
  const mergedByRequestId = new Map<
    string,
    { index: number; outputTokens: number; merged: RawJsonlRecord }
  >()

  // Track whether output_tokens actually increased for any requestId
  // (indicates real streaming continuation vs different content blocks)
  const hasStrictIncrease = new Set<string>()

  for (let i = 0; i < records.length; i++) {
    const rid = records[i].requestId
    if (!rid) continue

    const outputTokens = records[i].message?.usage?.output_tokens ?? 0
    const existing = mergedByRequestId.get(rid)

    if (existing) {
      if (outputTokens > existing.outputTokens) {
        // Strict increase — real streaming continuation, replace with this entry
        hasStrictIncrease.add(rid)
        mergedByRequestId.set(rid, { index: i, outputTokens, merged: records[i] })
      } else if (outputTokens === existing.outputTokens) {
        // Equal tokens — different content blocks (thinking/text/tool_use)
        // Merge content arrays into the existing entry
        existing.merged = mergeContentBlocks(existing.merged, records[i])
      }
      // Lower tokens: ignore (earlier streaming entry)
    } else {
      mergedByRequestId.set(rid, { index: i, outputTokens, merged: records[i] })
    }
  }

  // If no requestIds found, no dedup needed
  if (mergedByRequestId.size === 0) {
    return records
  }

  // Build set of original indices to replace
  const requestIdIndices = new Map<string, Set<number>>()
  for (let i = 0; i < records.length; i++) {
    const rid = records[i].requestId
    if (!rid) continue
    let indices = requestIdIndices.get(rid)
    if (!indices) {
      indices = new Set()
      requestIdIndices.set(rid, indices)
    }
    indices.add(i)
  }

  // Build result: for each requestId, output the merged record at the FIRST index,
  // skip all other indices for that requestId
  const result: RawJsonlRecord[] = []
  const emittedRequestIds = new Set<string>()

  for (let i = 0; i < records.length; i++) {
    const rid = records[i].requestId
    if (!rid) {
      // No requestId: pass through
      result.push(records[i])
      continue
    }

    const merged = mergedByRequestId.get(rid)
    if (!merged) continue

    if (!emittedRequestIds.has(rid)) {
      // Emit the merged record at the first occurrence
      result.push(merged.merged)
      emittedRequestIds.add(rid)
    }
    // Skip all other occurrences of this requestId
  }

  return result
}

/**
 * Merge content blocks from two records with the same requestId.
 * Concatenates the content arrays, keeping all unique content types.
 */
function mergeContentBlocks(
  existing: RawJsonlRecord,
  incoming: RawJsonlRecord,
): RawJsonlRecord {
  const existingContent = existing.message?.content
  const incomingContent = incoming.message?.content

  // If either doesn't have array content, keep the existing
  if (!Array.isArray(existingContent) || !Array.isArray(incomingContent)) {
    return existing
  }

  // Concatenate content arrays (thinking + text + tool_use blocks)
  const mergedContent = [...existingContent, ...incomingContent]

  return {
    ...existing,
    message: existing.message ? {
      ...existing.message,
      content: mergedContent,
    } : existing.message,
  }
}
