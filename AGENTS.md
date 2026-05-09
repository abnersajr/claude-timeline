# Project AGENTS.md

## Task Management
Use `/dex` to break down complex work, track progress across sessions, and coordinate multi-step implementations.

## Project Scope
Claude Code session timeline extractor: extract, merge, and structure session data from local Claude Code storage to rebuild full session timelines.

## Conventions
- **Language**: TypeScript, Node.js (no Bun)
- **Linting/Formatting**: Biome only (biome.json config). No ESLint, no Prettier.
- **Editor**: Follow `.editorconfig`
- **Module Structure**: Modular package with clear separation:
  - `src/types.ts` — Shared TypeScript interfaces
  - `src/db-reader.ts` — SQLite usage.db reading
  - `src/jsonl-parser.ts` — JSONL session file parsing
  - `src/merger.ts` — Merge SQLite + JSONL data
  - `src/pricing.ts` — Built-in model pricing lookup
  - `src/index.ts` — Main entry point
- **Output**: Unified JSON per session, matching schemas from `session-report.md`

## Agent Instructions
- Follow **brainstorming** skill for all design/creative work (mandatory before implementation).
- Use approved search tools for codebase exploration (no raw `grep`/`rg`/`find`).
- Batch file edits (5-10 files per call) using MCP ReadEdit-style tools.
- Commit messages: Conventional Commits format, ≤50 char subject. Use `caveman-commit` skill for compressed messages.
- Path resolution: Respect `CLAUDE_CONFIG_DIR` env var, default to `~/.claude`.

## Data Schemas
Reference `session-report.md` for:
- SQLite table schemas (`sessions`, `turns`)
- JSONL message/tool call structure
- Token types and pricing rates
- Turn-by-turn data examples
