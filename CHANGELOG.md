# Changelog

## 1.0.0

### Features

- Full session timeline extraction from Claude Code's local SQLite and JSONL data
- Per-turn and per-model cost tracking with token breakdowns
- Subagent detection and resolution
- Context window analysis across turns
- Interactive web UI with dark/light themes
- CLI for session extraction and cost analysis
- `update-pricing` command to fetch latest model pricing from Anthropic
- Real-time cost capture via Claude Code statusline wrapper
- Library exports for custom integrations (21 subpath exports)
- Support for all current Claude models (Opus 4.8, Sonnet 4.6, Haiku 4.5, and legacy)

### Infrastructure

- pnpm monorepo with Turborepo
- GitHub Actions CI (test + build)
- Changesets for versioning
- Biome for linting/formatting
- Vitest for testing
