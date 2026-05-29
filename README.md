<p align="center">
  <img src="packages/web/public/logo.svg" alt="claude-timeline" width="400" />
</p>

<p align="center">
  <strong>Extract and visualize Claude Code session timelines</strong><br/>
  Conversations · Tool calls · Pricing · Tokens · Subagents
</p>

<p align="center">
  <a href="https://github.com/abnersajr/claude-timeline/actions"><img src="https://github.com/abnersajr/claude-timeline/workflows/CI/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/claude-timeline"><img src="https://img.shields.io/npm/v/claude-timeline" alt="npm version" /></a>
  <a href="https://github.com/abnersajr/claude-timeline/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/claude-timeline" alt="license" /></a>
  <a href="https://ko-fi.com/abnersajr"><img src="https://img.shields.io/badge/Ko--fi-Support%20the%20project-ff5e5b?logo=ko-fi&logoColor=white" alt="Ko-fi" /></a>
</p>

> **👋 About me:** I'm Abner — a dev from Brazil 🇧🇷 now living in Montreal 🍁. This project started because I was frustrated with existing tools and decided to vibe-code my own. It grew into something real, and now I'm sharing it with the community.
>
> **☕ Donations** will support continued development of this project, and a portion will be donated to an NGO that takes care of animals 🐾. If this tool saved you time, consider fueling the next feature!

---

## Why This Exists

When a team member reported **929,057 cache read tokens** in a single Claude Code session, we had no way to understand what happened. The number sounded alarming, but turned out to be normal cumulative behavior across 28 turns costing only ~$0.28.

We built **claude-timeline** to answer questions like:

- How many tokens did this session actually use?
- Which tool calls cost the most?
- Why does a 10-turn session cost more than expected?
- Are subagents running in parallel?
- What's the context window doing across turns?

Claude Code stores rich session data in local SQLite and JSONL files, but there's no built-in way to see the full picture. claude-timeline extracts, merges, and visualizes everything.

## What is this?

**claude-timeline** extracts and rebuilds full session timelines from Claude Code's local data stores. It merges SQLite (`usage.db`) and JSONL session files into a unified, structured format.

### Features

- 📊 **Full session timelines** — conversations, tool calls, file edits, all in order
- 💰 **Cost tracking** — per-turn and per-model pricing with token breakdowns
- 🤖 **Subagent detection** — automatically identifies and resolves subagent sessions
- 🧠 **Context analysis** — tracks context window usage, phases, and injections
- 🎨 **Web UI** — interactive timeline visualization with dark/light themes
- ⚡ **CLI tool** — extract session data from the command line
- 📦 **Library** — import individual modules for custom integrations

## Quick Start

### Web UI (recommended)

```bash
# One command — starts server + opens browser
npx claude-timeline serve

# Custom port
npx claude-timeline serve --port 3000
```

Then open `http://localhost:5199` in your browser.

### CLI

```bash
# List recent sessions
npx claude-timeline --list-sessions

# Extract a specific session to JSON
npx claude-timeline --session-id <session-id>
```

### Library

```bash
npm install claude-timeline-extractor
```

```typescript
import { extractFullTimeline } from "claude-timeline-extractor";

const session = await extractFullTimeline(
  sessionId,
  "~/.claude/usage.db",
  "~/.claude/projects"
);

console.log(session.turns.length, "turns");
console.log(`Total cost: $${session.pricing.totalCost.toFixed(4)}`);
```

### Development

```bash
# Clone the repo
git clone https://github.com/abnersajr/claude-timeline.git
cd claude-timeline

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

The web UI will be available at `http://localhost:5199`.

## Understanding Claude Code Sessions

To get the most out of claude-timeline, it helps to understand how Claude Code works under the hood.

### Core Concepts

| Concept | What it is |
|---------|------------|
| **Session** | A single Claude Code interaction lifecycle. Started when you launch `claude` or run a slash command. All work shares a persistent conversation history. |
| **Turn** | A single API call to the Claude model. Each turn includes cached context, new input, and model output. |
| **Token** | A unit of text (~4 English characters). All billing is token-based. "Hello world" is roughly 3 tokens. |
| **Prompt Caching** | Claude caches repeated context (system prompt, conversation history) to avoid re-processing. Cached context is billed at 10% of standard input rates. |

### How Tokens Are Billed

Every Claude Code interaction uses four billable token types:

| Token Type | What it means | Cost (Sonnet 4) |
|------------|---------------|-----------------|
| **Input** | New text sent to the model that is NOT cached. Usually tiny (1-2 tokens). | $3.00 / MTok |
| **Output** | Model-generated text, tool requests, thinking. The most expensive type. | $15.00 / MTok |
| **Cache Creation** | One-time cost to write context to the cache. | $3.75 / MTok |
| **Cache Read** | Per-turn cost to retrieve cached context. Compounds over turns. | $0.30 / MTok |

> **Key insight**: `input_tokens` is NOT the total input. It's the non-cached delta (typically 1-2 tokens). The bulk of your context is in `cache_read_input_tokens`.

### How Cache Read Compounds

Each turn reads the entire cached context (system prompt + all previous conversation). As the conversation grows, so does cache read:

| Session Length | Avg Cache Read/Turn | Total Cache Read | Cache Read Cost |
|----------------|---------------------|------------------|-----------------|
| 1 turn | 12k | 12k | ~$0.004 |
| 10 turns | 34k | 340k | ~$0.10 |
| 28 turns | 33k | 929k | ~$0.28 |
| 100 turns | 35k | 3.5M | ~$1.05 |

The 929k number sounds large, but at $0.30/MTok it costs less than a quarter. **Output tokens are 5x more expensive** than cache read.

### How Tool Calls Affect Cost

Tool results (success or failure) are added to conversation history. Large tool outputs compound:

- Reading a 100k-token file in Turn 5 adds 100k tokens to history
- Turns 6-28 each read that extra 100k in cache
- Cost: 23 turns × 100k × $0.30/MTok = ~$0.69 extra

This is why targeted searches (`grep "ERROR" app.log`) are cheaper than reading entire files (`cat app.log`).

## Tips for Efficient Sessions

| Strategy | Impact |
|----------|--------|
| **Start in the project directory** | `cd ~/projects/my-app && claude` instead of `cd ~ && claude "fix X in my-app"`. Broader scope = more file discovery = more cache bloat. |
| **Use exact file paths** | "Edit `src/components/Button.tsx`" instead of "edit the button component". Reduces discovery turns. |
| **Batch related tasks** | "Fix X, Y, Z" in one session vs three separate sessions. Fewer turns = less cumulative cache read. |
| **Keep sessions under 15 turns** | After 10-15 turns, restart to reset cache accumulation. A 10-turn session costs ~$0.18 vs ~$0.63 for 28 turns. |
| **Watch tool output sizes** | Use `head`, `tail`, `grep` to limit output. A 100k-token file read adds ~$0.69 in cache bloat over 28 turns. |
| **Use `.claudeignore`** | Exclude `node_modules/`, `dist/`, `*.log` from discovery to prevent unrelated files from entering context. |

## CLI Reference

```
claude-timeline <command> [options]

Commands:
  serve [--port <port>]    Start web UI + API server (default: 5199)
  extract --session-id <id> Extract a specific session to JSON
  list                     List all available sessions
  setup                    Install cost-capture statusline wrapper
  update-pricing           Fetch latest model pricing from Anthropic
  --help                   Show help

Options:
  --port <port>            Server port (serve mode, default: 5199)
  --db-path <path>         SQLite DB path (default: ~/.claude/usage.db)
  --projects-dir <path>    Projects directory (default: ~/.claude/projects)
  --output <path>          Write JSON to file instead of stdout
```

## Architecture

```
claude-timeline/
├── extractor/          # Core library — the npm package
│   ├── src/
│   │   ├── index.ts          # CLI + main entry
│   │   ├── db-reader.ts      # SQLite usage.db reader
│   │   ├── jsonl-parser.ts   # JSONL session file parser
│   │   ├── merger.ts         # Merge SQLite + JSONL data
│   │   ├── pricing.ts        # Model pricing lookup
│   │   ├── pricing-scraper.ts # Fetch pricing from Anthropic docs
│   │   ├── classifier.ts     # Message classification
│   │   ├── tool-extraction.ts # Tool call extraction
│   │   ├── subagent-*.ts     # Subagent detection + resolution
│   │   ├── context-tracker.ts # Context window analysis
│   │   └── types.ts          # TypeScript interfaces
│   └── bin/cli.js      # CLI entry point
├── api/                # Express API server
├── types/              # Shared TypeScript types
├── web/                # React 19 + Tailwind v4 web UI
└── docs/               # Design documents
```

## Data Sources

| Source | Location | Contents |
|--------|----------|----------|
| SQLite | `~/.claude/usage.db` | Sessions, turns, token counts |
| JSONL | `~/.claude/projects/<project>/<session>.jsonl` | Full message content, tool calls, file paths |

## Module Exports

The package exports individual modules for tree-shaking:

```typescript
// Main entry
import { extractFullTimeline } from "claude-timeline-extractor";

// Individual modules
import { parseJsonlFile } from "claude-timeline-extractor/jsonl-parser";
import { readUsageDb } from "claude-timeline-extractor/db-reader";
import { calculatePricing } from "claude-timeline-extractor/pricing";
```

## Troubleshooting

### Find your recent sessions

```bash
sqlite3 ~/.claude/usage.db "SELECT session_id, project_name, total_cache_read, turn_count, last_timestamp FROM sessions WHERE last_timestamp > datetime('now', '-1 day') ORDER BY total_cache_read DESC LIMIT 5;"
```

### Get full token breakdown for a session

```bash
sqlite3 ~/.claude/usage.db "SELECT timestamp, cache_read_tokens, cache_creation_tokens, input_tokens, output_tokens, tool_name FROM turns WHERE session_id='YOUR_SESSION_ID' ORDER BY timestamp;"
```

### Calculate session cost (Sonnet 4 rates)

```bash
sqlite3 ~/.claude/usage.db "SELECT
  session_id,
  ROUND(total_cache_read * 0.30 / 1000000, 4) AS cache_read_USD,
  ROUND(total_output_tokens * 15.00 / 1000000, 4) AS output_USD,
  ROUND(total_cache_creation * 3.75 / 1000000, 4) AS creation_USD,
  ROUND(total_input_tokens * 3.00 / 1000000, 4) AS input_USD,
  ROUND((total_cache_read * 0.30 + total_output_tokens * 15.00 + total_cache_creation * 3.75 + total_input_tokens * 3.00) / 1000000, 4) AS total_USD
FROM sessions WHERE session_id='YOUR_SESSION_ID';"
```

### Check which files were read in a session

```bash
cat ~/.claude/projects/YOUR_PROJECT_DIR/YOUR_SESSION_ID.jsonl | jq -r 'select(.type == "assistant" and .message.content) | .message.content[]? | select(.type == "tool_use" and .name == "Read") | .input.filePath' 2>/dev/null
```

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint

# Build all packages
pnpm build
```

## License

[MIT](LICENSE)
