/**
 * Scraper for Anthropic's pricing page.
 *
 * Fetches the HTML pricing table from https://platform.claude.com/docs/en/about-claude/pricing
 * and extracts model names + rates. No public API exists — this parses the structured HTML.
 *
 * Used by `claude-timeline update-pricing` to regenerate the pricing data file.
 */
import type { PricingRate } from "./types.js"

const PRICING_URL = "https://platform.claude.com/docs/en/about-claude/pricing"

/**
 * Parse a dollar string like "$5 / MTok" or "$0.50 / MTok" into a number.
 * Returns NaN if unparseable.
 */
function parseDollarMTok(s: string): number {
  const match = s.match(/\$(\d+(?:\.\d+)?)/)
  return match ? Number.parseFloat(match[1]) : Number.NaN
}

/**
 * Convert a human-readable model name to an API model ID.
 *
 * "Claude Opus 4.8"   → "claude-opus-4-8"
 * "Claude Sonnet 4.6" → "claude-sonnet-4-6"
 * "Claude Haiku 4.5"  → "claude-haiku-4-5"
 */
function displayNameToApiId(name: string): string {
  return name
    .replace(/^Claude\s+/i, "claude-")
    .replace(/\s+/g, "-")
    .replace(/\./g, "-")
    .toLowerCase()
}

/**
 * Parse the HTML pricing table into structured PricingRate objects.
 *
 * The table has columns: Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens
 */
function parsePricingTable(html: string): PricingRate[] {
  // Find all table rows — each row is <tr>...</tr>
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi
  const stripTags = (s: string) => s.replace(/<[^>]*>/g, "").trim()

  const results: PricingRate[] = []
  let headerSkipped = false

  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = rowMatch[1]

    // Extract all cells from this row
    const cells: string[] = []
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(stripTags(cellMatch[1]))
    }

    // Skip header row and rows without enough cells
    if (!headerSkipped) {
      headerSkipped = true
      continue
    }
    if (cells.length < 6) continue

    const [displayName, inputStr, cache5mStr, cache1hStr, cacheReadStr, outputStr] = cells

    // Skip rows that don't look like model pricing (e.g. footnotes, cloud pricing tables)
    if (!displayName.toLowerCase().includes("claude")) continue

    const input = parseDollarMTok(inputStr)
    const output = parseDollarMTok(outputStr)
    const cacheRead = parseDollarMTok(cacheReadStr)
    const cache5m = parseDollarMTok(cache5mStr)
    const cache1h = parseDollarMTok(cache1hStr)

    // Skip if any price failed to parse
    if ([input, output, cacheRead, cache5m, cache1h].some(Number.isNaN)) continue

    // Strip deprecation markers from display name
    const cleanName = displayName.replace(/\s*\(.*?\)\s*/g, "").trim()
    const model = displayNameToApiId(cleanName)

    results.push({
      model,
      inputPerMTok: input,
      outputPerMTok: output,
      cacheReadPerMTok: cacheRead,
      cacheCreation5mPerMTok: cache5m,
      cacheCreation1hPerMTok: cache1h,
    })
  }

  return results
}

/**
 * Fetch and parse the Anthropic pricing page.
 * Returns a Record keyed by model ID, suitable for writing to pricing-data.json.
 */
export async function scrapePricing(): Promise<Record<string, PricingRate>> {
  const res = await fetch(PRICING_URL, {
    headers: {
      "User-Agent": "claude-timeline/1.0 (pricing updater)",
      Accept: "text/html",
    },
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch pricing page: ${res.status} ${res.statusText}`)
  }

  const html = await res.text()
  const rates = parsePricingTable(html)

  if (rates.length === 0) {
    throw new Error("No pricing data found on the page — HTML structure may have changed")
  }

  const table: Record<string, PricingRate> = {}
  for (const rate of rates) {
    table[rate.model] = rate
  }

  return table
}

// Exported for testing
export { parsePricingTable, parseDollarMTok, displayNameToApiId, PRICING_URL }
