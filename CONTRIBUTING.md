# Contributing to Claude Code Session Timeline Extractor

Thank you for considering contributing! This project extracts, merges, and structures session data from local Claude Code storage.

## Project Phases
1. **Standalone Extractor**: TypeScript/Node.js module (current phase)
2. **CLI Wrapper**: Command-line interface around the extractor
3. **WebUI**: React-like app for interactive timeline visualization

## Key Assumptions & Caveats

### Cache Read Type Inference (Important!)
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

### SQLite vs JSONL Data Priority
**File**: `src/merger.ts`

When merging data from SQLite (`usage.db`) and JSONL (`session.jsonl`):
- **JSONL is preferred** for cache creation breakdown (has `ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`)
- **SQLite is used as fallback** when JSONL data is unavailable or malformed
- **Token counts** from SQLite `turns` table are considered authoritative (matches what was billed)

### Model Pricing Rates
**File**: `src/pricing.ts`

Pricing rates are hardcoded from Anthropic's published docs (as of April 2026). When new models release:
1. Update the `PRICING_TABLE` in `src/pricing.ts`
2. Add tests for the new model
3. Check if cache pricing tiers changed (5m = 1.25x input, 1h = 2x input as of Sonnet 4.6)

### Path Resolution
**File**: `src/utils.ts`

The extractor respects `CLAUDE_CONFIG_DIR` env var, defaulting to `~/.claude`. The JSONL file path is constructed as:
```
~/.claude/projects/<encoded_project_name>/<session_id>.jsonl
```

The `encoded_project_name` is derived from the `sessions.project_name` field in SQLite (e.g., `/Users/abnersoaresalvesjunior` → `-Users-abnersoaresalvesjunior`).

## Code Style
- **Linting/Formatting**: Biome (see `biome.json`)
- **Editor**: Follow `.editorconfig`
- **Comments**: Add inline comments for assumptions, caveats, and non-obvious inference logic (see "Key Assumptions" above)
- **Types**: Use TypeScript interfaces from `src/types.ts`; don't use `any` without a comment explaining why

## Pull Request Process
1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (use Conventional Commits, ≤50 char subject)
4. Push to your branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Adding New Features
- **New data sources**: Update `src/types.ts` first, then `src/db-reader.ts` or `src/jsonl-parser.ts`
- **New pricing models**: Update `src/pricing.ts` and add tests
- **New output formats**: Add a new module (e.g., `src/csv-exporter.ts`) that consumes `FullTimelineSession` from `src/merger.ts`

## Questions?
Open an issue or check `session-report.md` for data schema references.
