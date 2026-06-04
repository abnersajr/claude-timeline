import { describe, expect, test, vi, beforeEach } from "vitest"
import { fetchFromOpenRouter, isCacheStale, refreshPricing } from "../src/pricing.js"
import type { PricingFile, PricingRate } from "../src/types.js"

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

describe("fetchFromOpenRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("fetches and normalizes Claude models", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: "anthropic/claude-opus-4.8",
              name: "Anthropic: Claude Opus 4.8",
              pricing: {
                prompt: "0.000005",
                completion: "0.000025",
                input_cache_read: "0.0000005",
                input_cache_write: "0.00000625",
              },
            },
            {
              id: "anthropic/claude-sonnet-4.6",
              name: "Anthropic: Claude Sonnet 4.6",
              pricing: {
                prompt: "0.000003",
                completion: "0.000015",
                input_cache_read: "0.0000003",
                input_cache_write: "0.00000375",
              },
            },
            // Non-Claude model — should be skipped
            {
              id: "openai/gpt-4o",
              name: "OpenAI: GPT-4o",
              pricing: { prompt: "0.000005", completion: "0.000015" },
            },
          ],
        }),
    })

    const models = await fetchFromOpenRouter()

    expect(Object.keys(models)).toHaveLength(2)
    expect(models["claude-opus-4-8"]).toEqual({
      model: "claude-opus-4-8",
      inputPerMTok: 5.0,
      outputPerMTok: 25.0,
      cacheReadPerMTok: 0.5,
      cacheWritePerMTok: 6.25,
    })
    expect(models["claude-sonnet-4-6"]).toEqual({
      model: "claude-sonnet-4-6",
      inputPerMTok: 3.0,
      outputPerMTok: 15.0,
      cacheReadPerMTok: 0.3,
      cacheWritePerMTok: 3.75,
    })
  })

  test("strips anthropic/ prefix and normalizes dots", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: "anthropic/claude-opus-4.8",
              name: "Anthropic: Claude Opus 4.8",
              pricing: {
                prompt: "0.000005",
                completion: "0.000025",
                input_cache_read: "0.0000005",
                input_cache_write: "0.00000625",
              },
            },
          ],
        }),
    })

    const models = await fetchFromOpenRouter()
    expect(models["claude-opus-4-8"]).toBeDefined()
    expect(models["anthropic/claude-opus-4.8"]).toBeUndefined()
    expect(models["claude-opus-4.8"]).toBeUndefined()
  })

  test("skips models with missing pricing fields", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: "anthropic/claude-opus-4.8",
              name: "Anthropic: Claude Opus 4.8",
              pricing: { prompt: "0.000005", completion: "0.000025" }, // missing cache fields
            },
          ],
        }),
    })

    await expect(fetchFromOpenRouter()).rejects.toThrow("No Claude models found")
  })

  test("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    })

    await expect(fetchFromOpenRouter()).rejects.toThrow("OpenRouter API error: 500")
  })

  test("throws when no Claude models found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: "openai/gpt-4o",
              name: "OpenAI: GPT-4o",
              pricing: { prompt: "0.000005", completion: "0.000015" },
            },
          ],
        }),
    })

    await expect(fetchFromOpenRouter()).rejects.toThrow("No Claude models found")
  })
})

describe("isCacheStale", () => {
  test("returns false for recent data", () => {
    const data: PricingFile = {
      fetchedAt: new Date().toISOString(),
      models: {},
    }
    expect(isCacheStale(data)).toBe(false)
  })

  test("returns true for data older than 5 days", () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
    const data: PricingFile = {
      fetchedAt: sixDaysAgo.toISOString(),
      models: {},
    }
    expect(isCacheStale(data)).toBe(true)
  })

  test("returns false for data exactly 4 days old", () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
    const data: PricingFile = {
      fetchedAt: fourDaysAgo.toISOString(),
      models: {},
    }
    expect(isCacheStale(data)).toBe(false)
  })
})
