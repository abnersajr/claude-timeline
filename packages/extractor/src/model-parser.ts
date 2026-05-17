/**
 * Model name parser for multi-model sessions.
 *
 * Strips provider prefixes and date suffixes from raw model strings
 * to produce a normalized key suitable for pricing lookups.
 *
 * Examples:
 *   "anthropic/claude-sonnet-4-20250514" → "claude-sonnet-4"
 *   "claude-opus-4-20250514"              → "claude-opus-4"
 *   "claude-sonnet-4-6"                   → "claude-sonnet-4-6"
 */

/** Date suffix pattern: 8-digit date at the end of the string */
const DATE_SUFFIX_RE = /^(.+)-\d{8}$/

/**
 * Parse a raw model string into a normalized form for pricing lookups.
 *
 * - Strips provider prefix (e.g. "anthropic/")
 * - Strips date suffix (e.g. "-20250514")
 * - Lowercases the result
 * - Returns "unknown" for null/undefined/empty/whitespace
 */
export function parseModelName(raw: string | null | undefined): string {
  if (!raw) return "unknown"

  const trimmed = raw.trim()
  if (trimmed === "") return "unknown"

  // Strip provider prefix (e.g. "anthropic/")
  const slashIndex = trimmed.indexOf("/")
  const withoutPrefix = slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed

  // Strip date suffix (e.g. "-20250514")
  const dateMatch = DATE_SUFFIX_RE.exec(withoutPrefix)
  const withoutDate = dateMatch ? dateMatch[1] : withoutPrefix

  return withoutDate.toLowerCase()
}

/**
 * Alias for parseModelName — ensures consistent key format for pricing lookup.
 */
export const normalizeModelName = parseModelName
