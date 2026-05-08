# Claude Code Session Timeline Extractor

Standalone TypeScript data extractor to rebuild full session timelines (conversation, tool calls, pricing, tokens) from Claude Code's local data.

## Phases
1. **Standalone Extractor**: TypeScript/Node.js module, merges `usage.db` (SQLite) and `session.jsonl` (JSONL) into unified JSON.
2. **CLI Wrapper**: Wrap extractor in a command-line interface.
3. **WebUI**: React-like app to visualize timelines interactively.

## Tech Stack
- Node.js (no Bun)
- TypeScript
- Biome (linting/formatting, no ESLint/Prettier)
- editorconfig

## Setup
```bash
npm install
npm run build
```

## Usage (Standalone Extractor)
```bash
# Basic usage (uses default paths)
tsx src/index.ts --session-id <session_id>

# Custom paths
tsx src/index.ts \
  --session-id <id> \
  --db-path ~/.claude/usage.db \
  --projects-dir ~/.claude/projects
```

## Data Sources
- SQLite: `~/.claude/usage.db` (sessions, turns tables)
- JSONL: `~/.claude/projects/<encoded_project>/<session_id>.jsonl`
- Pricing: Built-in model lookup table (matches Anthropic's published rates)
