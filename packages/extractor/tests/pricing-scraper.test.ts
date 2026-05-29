import { describe, expect, test } from "vitest"
import { parseDollarMTok, displayNameToApiId, parsePricingTable } from "../src/pricing-scraper.js"

describe("parseDollarMTok", () => {
  test("parses $5 / MTok", () => {
    expect(parseDollarMTok("$5 / MTok")).toBe(5)
  })

  test("parses $0.50 / MTok", () => {
    expect(parseDollarMTok("$0.50 / MTok")).toBe(0.5)
  })

  test("parses $15.0 / MTok", () => {
    expect(parseDollarMTok("$15.0 / MTok")).toBe(15)
  })

  test("parses $0.80 / MTok", () => {
    expect(parseDollarMTok("$0.80 / MTok")).toBe(0.8)
  })

  test("returns NaN for unparseable strings", () => {
    expect(Number.isNaN(parseDollarMTok("N/A"))).toBe(true)
    expect(Number.isNaN(parseDollarMTok(""))).toBe(true)
  })
})

describe("displayNameToApiId", () => {
  test("Claude Opus 4.8 → claude-opus-4-8", () => {
    expect(displayNameToApiId("Claude Opus 4.8")).toBe("claude-opus-4-8")
  })

  test("Claude Sonnet 4.6 → claude-sonnet-4-6", () => {
    expect(displayNameToApiId("Claude Sonnet 4.6")).toBe("claude-sonnet-4-6")
  })

  test("Claude Haiku 4.5 → claude-haiku-4-5", () => {
    expect(displayNameToApiId("Claude Haiku 4.5")).toBe("claude-haiku-4-5")
  })

  test("Claude Opus 4 → claude-opus-4", () => {
    expect(displayNameToApiId("Claude Opus 4")).toBe("claude-opus-4")
  })
})

describe("parsePricingTable", () => {
  // Minimal HTML mimicking the Anthropic pricing table structure
  const sampleHtml = `
    <table>
      <tr>
        <th>Model</th>
        <th>Base Input Tokens</th>
        <th>5m Cache Writes</th>
        <th>1h Cache Writes</th>
        <th>Cache Hits &amp; Refreshes</th>
        <th>Output Tokens</th>
      </tr>
      <tr>
        <td>Claude Opus 4.8</td>
        <td>$5 / MTok</td>
        <td>$6.25 / MTok</td>
        <td>$10 / MTok</td>
        <td>$0.50 / MTok</td>
        <td>$25 / MTok</td>
      </tr>
      <tr>
        <td>Claude Sonnet 4.6</td>
        <td>$3 / MTok</td>
        <td>$3.75 / MTok</td>
        <td>$6 / MTok</td>
        <td>$0.30 / MTok</td>
        <td>$15 / MTok</td>
      </tr>
      <tr>
        <td>Claude Haiku 4.5</td>
        <td>$1 / MTok</td>
        <td>$1.25 / MTok</td>
        <td>$2 / MTok</td>
        <td>$0.10 / MTok</td>
        <td>$5 / MTok</td>
      </tr>
      <tr>
        <td>Claude Opus 4 (deprecated)</td>
        <td>$15 / MTok</td>
        <td>$18.75 / MTok</td>
        <td>$30 / MTok</td>
        <td>$1.50 / MTok</td>
        <td>$75 / MTok</td>
      </tr>
    </table>
  `

  test("parses all models from sample HTML", () => {
    const rates = parsePricingTable(sampleHtml)
    expect(rates).toHaveLength(4)
  })

  test("correctly converts display names to API IDs", () => {
    const rates = parsePricingTable(sampleHtml)
    const ids = rates.map((r) => r.model)
    expect(ids).toContain("claude-opus-4-8")
    expect(ids).toContain("claude-sonnet-4-6")
    expect(ids).toContain("claude-haiku-4-5")
    expect(ids).toContain("claude-opus-4")
  })

  test("strips (deprecated) from display names", () => {
    const rates = parsePricingTable(sampleHtml)
    const opus4 = rates.find((r) => r.model === "claude-opus-4")
    expect(opus4).toBeDefined()
    expect(opus4!.model).not.toContain("deprecated")
  })

  test("correctly parses pricing values", () => {
    const rates = parsePricingTable(sampleHtml)
    const opus48 = rates.find((r) => r.model === "claude-opus-4-8")!
    expect(opus48.inputPerMTok).toBe(5)
    expect(opus48.outputPerMTok).toBe(25)
    expect(opus48.cacheReadPerMTok).toBe(0.5)
    expect(opus48.cacheCreation5mPerMTok).toBe(6.25)
    expect(opus48.cacheCreation1hPerMTok).toBe(10)
  })

  test("skips rows without enough cells", () => {
    const html = `
      <table>
        <tr><th>A</th><th>B</th></tr>
        <tr><td>short</td></tr>
        <tr>
          <td>Claude Opus 4.8</td>
          <td>$5 / MTok</td>
          <td>$6.25 / MTok</td>
          <td>$10 / MTok</td>
          <td>$0.50 / MTok</td>
          <td>$25 / MTok</td>
        </tr>
      </table>
    `
    const rates = parsePricingTable(html)
    expect(rates).toHaveLength(1)
    expect(rates[0].model).toBe("claude-opus-4-8")
  })

  test("skips non-Claude rows", () => {
    const html = `
      <table>
        <tr><th>A</th><th>B</th><th>C</th><th>D</th><th>E</th><th>F</th></tr>
        <tr>
          <td>Some Other Model</td>
          <td>$1 / MTok</td>
          <td>$1 / MTok</td>
          <td>$1 / MTok</td>
          <td>$1 / MTok</td>
          <td>$1 / MTok</td>
        </tr>
        <tr>
          <td>Claude Sonnet 4.6</td>
          <td>$3 / MTok</td>
          <td>$3.75 / MTok</td>
          <td>$6 / MTok</td>
          <td>$0.30 / MTok</td>
          <td>$15 / MTok</td>
        </tr>
      </table>
    `
    const rates = parsePricingTable(html)
    expect(rates).toHaveLength(1)
    expect(rates[0].model).toBe("claude-sonnet-4-6")
  })

  test("returns empty array for table with no Claude models", () => {
    const html = `
      <table>
        <tr><th>A</th><th>B</th><th>C</th><th>D</th><th>E</th><th>F</th></tr>
        <tr>
          <td>GPT-4o</td>
          <td>$2 / MTok</td>
          <td>$2 / MTok</td>
          <td>$2 / MTok</td>
          <td>$2 / MTok</td>
          <td>$8 / MTok</td>
        </tr>
      </table>
    `
    const rates = parsePricingTable(html)
    expect(rates).toHaveLength(0)
  })
})
