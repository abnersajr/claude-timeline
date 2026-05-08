## 5. Key Assumptions & Caveats

### 5.1 Cache Read Type Inference (Important!)

**File**: `src/merger.ts`, `src/types.ts`

The Claude API **does not** tag cache read tokens with their TTL (5-minute vs 1-hour). The API response only includes:

```json
"cache_creation": {
  "ephemeral_5m_input_tokens": 456,
  "ephemeral_1h_input_tokens": 100
}
```

For **cache writes**, we know the exact tier from `ephemeral_5m_input_tokens` vs `ephemeral_1h_input_tokens`.

For **cache reads**, we **infer** the type based on:
1. Looking at the previous turn's cache write type
2. Checking if the time difference is within the TTL window (5 min for 5m, 1 hour for 1h)
3. Defaulting to '5m' if uncertain (most sessions use default 5m TTL)

**This inference is NOT definitive.** The API doesn't provide this information. For display purposes in the UI, this inference is good enough, but do not use it for billing audits without verification.

**Code locations to check**:
- `src/types.ts`: `Turn.cacheReadType` field (type: `'5m' | '1h' | 'unknown'`)
- `src/merger.ts`: `inferCacheReadType()` function (contains the inference logic)
- `src/pricing.ts`: Uses `cacheReadType` for cost calculation (falls back to 5m rate if unknown)

### 5.2 SQLite vs JSONL Data Priority

**File**: `src/merger.ts`

When merging data from SQLite (`usage.db`) and JSONL (`session.jsonl`):
- **JSONL is preferred** for cache creation breakdown (has `ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`)
- **SQLite is used as fallback** when JSONL data is unavailable or malformed
- **Token counts** from SQLite `turns` table are considered authoritative (matches what was billed)

### 5.3 Model Pricing Rates

**File**: `src/pricing.ts`

Pricing rates are hardcoded from Anthropic's published docs (as of April 2026). When new models release:
1. Update the `PRICING_TABLE` in `src/pricing.ts`
2. Add tests for the new model
3. Check if cache pricing tiers changed (5m = 1.25x input, 1h = 2x input as of Sonnet 4.6)

### 5.4 Path Resolution

**File**: `src/utils.ts`

The extractor respects `CLAUDE_CONFIG_DIR` env var, defaulting to `~/.claude`. The JSONL file path is constructed as:
```
~/.claude/projects/<encoded_project_name>/<session_id>.jsonl
```

The `encoded_project_name` is derived from the `sessions.project_name` field in SQLite (e.g., `/Users/abnersoaresalvesjunior` → `-Users-abnersoaresalvesjunior`).

---

## 6. Future: Streaming Parser Integration

See `docs/streaming-parser-plan.md` for detailed integration strategy.

**Why Streaming Parsing?**
- Large sessions (1000+ turns) where in-memory JSONL parsing uses excessive RAM
- Low latency: Start processing before entire file is read
- Future WebUI: Stream partial results to browser as they're parsed
- Parallel multi-session: Process multiple sessions concurrently with bounded memory

**Integration Strategy**:
- Keep original `jsonl-parser.ts` as default (simple, works for 99% of sessions)
- Add `streaming-jsonl-parser.ts` as optional upgrade
- Update `merger.ts` to accept either in-memory or streaming input
- Add config flag: `useStreaming: boolean` (default: false)

---

## 7. Output Format

### JSON Structure (matches Appendix B.9 from session-report.md)

```json
{
  "session": {
    "sessionId": "19500eaa-3cc6-4111-a82d-f158e7f76ad3",
    "projectName": "/Users/abnersoaresalvesjunior",
    "model": "claude-sonnet-4-6",
    "commandExecuted": "/claude-hud:setup",
    "workingDirectory": "/Users/abnersoaresalvesjunior",
    "turnCount": 28,
    "totalTokens": { /*...*/ },
    "startTime": "2026-05-07T19:22:45.118Z",
    "endTime": "2026-05-07T19:30:01.208Z"
  },
  "turns": [
    {
      "timestamp": "2026-05-07T19:22:45.118Z",
      "tokenUsage": {
        "inputTokens": 2,
        "outputTokens": 323,
        "cacheReadTokens": 12143,
        "cacheCreation5mTokens": 0,
        "cacheCreation1hTokens": 12973,
        "cacheCreationTokens": 12973
      },
      "toolName": "Bash",
      "cacheWriteType": "1h",
      "cacheReadType": "1h",
      "messages": [ /*...*/ ],
      "toolCalls": [ /*...*/ ]
    }
    /*... 27 more turns */
  ],
  "pricing": {
    "totalCost": 0.6261,
    "turnsPricing": [ /* per-turn costs */ ],
    "pricingRate": {
      "model": "claude-sonnet-4-6",
      "inputPerMTok": 3.00,
      "outputPerMTok": 15.00,
      "cacheReadPerMTok": 0.30,
      "cacheCreation5mPerMTok": 3.75,
      "cacheCreation1hPerMTok": 6.00
    }
  }
}
```

---

## 8. Tech Stack & Conventions

- **Language**: TypeScript, Node.js (no Bun)
- **Linting/Formatting**: Biome only (biome.json config). No ESLint, no Prettier.
- **Editor**: Follow `.editorconfig`
- **Module Structure**: Modular package with clear separation (see Section 1)
- **Output**: Unified JSON per session, matching schemas from `session-report.md`
- **Path Resolution**: Respect `CLAUDE_CONFIG_DIR` env var, default to `~/.claude`

---

## 9. References

- `session-report.md` — Data schemas, investigation methodology, turn-by-turn examples
- `docs/streaming-parser-plan.md` — Future streaming parser integration
- `CONTRIBUTING.md` — Contributor guidelines, assumptions documentation
- `AGENTS.md` — Project-specific instructions and conventions
- Anthropic Pricing Docs — https://docs.anthropic.com/en/docs/about-claude/pricing
- Anthropic Prompt Caching Docs — https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching

---

**End of Design Doc**
