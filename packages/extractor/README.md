# claude-timeline-extractor

Extract and visualize Claude Code session timelines — conversations, tool calls, pricing, and tokens.

## Install

```bash
npm install claude-timeline-extractor
```

Requires Node.js >= 22.

## Quick Start

```typescript
import { extractFullTimeline } from 'claude-timeline-extractor'

const timeline = await extractFullTimeline(
  sessionId,
  '~/.claude/usage.db',
  '~/.claude/projects',
)

console.log(timeline.pricing.totalCost)
console.log(timeline.session.turnCount)
```

## Subpath Exports

The package exposes 21 focused entry points so you can import only what you need:

| Import | Description |
|--------|-------------|
| `claude-timeline-extractor` | Main entry — `extractFullTimeline()`, `extractJsonlTimeline()`, CLI arg parsing |
| `claude-timeline-extractor/types` | All TypeScript interfaces and type aliases (`FullTimelineSession`, `Turn`, `ToolCall`, etc.) |
| `claude-timeline-extractor/merger` | Merge SQLite + JSONL data into a unified timeline; includes `matchTurnsToMessages()` |
| `claude-timeline-extractor/db-reader` | Read session metadata and turns from Claude Code's SQLite `usage.db` |
| `claude-timeline-extractor/jsonl-parser` | Parse `.jsonl` session files into deduplicated records, tool calls, and categories |
| `claude-timeline-extractor/dedup` | Deduplicate streaming assistant entries by `requestId` (keeps last entry per request) |
| `claude-timeline-extractor/classifier` | 5-category message classification: `user`, `assistant`, `system`, `compact`, `hardNoise` |
| `claude-timeline-extractor/noise-filter` | Filter out noise entries (sidechains, synthetic messages, system reminders) |
| `claude-timeline-extractor/tool-extraction` | Extract `tool_use`/`tool_result` blocks and link them by ID |
| `claude-timeline-extractor/tool-matcher` | Match tool calls to results and compute execution timing (`ToolExecution[]`) |
| `claude-timeline-extractor/model-parser` | Normalize model names — strip provider prefixes and date suffixes for pricing lookups |
| `claude-timeline-extractor/pricing` | Cost calculation engine with built-in rates for all Claude models |
| `claude-timeline-extractor/pricing-scraper` | Scrape live pricing data from Anthropic's pricing page |
| `claude-timeline-extractor/context-tracker` | Track context window consumption by category across compaction phases |
| `claude-timeline-extractor/conversation-groups` | Group turns into user-message + AI-response conversation units |
| `claude-timeline-extractor/session-state` | Detect whether a session is ongoing or completed |
| `claude-timeline-extractor/subagent-locator` | Discover subagent `agent-*.jsonl` files on disk (nested and legacy layouts) |
| `claude-timeline-extractor/subagent-resolver` | Parse subagent files, link to parent Task calls, detect parallel execution |
| `claude-timeline-extractor/cost-stream-db` | SQLite CRUD layer for ground-truth cost snapshots from Claude Code's stdin stream |
| `claude-timeline-extractor/cost-stream-merger` | Merge API cost-stream data into the extraction pipeline (estimated + API streams) |
| `claude-timeline-extractor/utils` | Path resolution, project name encoding, JSONL file lookup utilities |

## TypeScript Types

All types are exported from `claude-timeline-extractor/types`:

```typescript
import type {
  FullTimelineSession,
  SessionMetadata,
  Turn,
  TurnPricing,
  SessionPricing,
  ToolCall,
  ToolExecution,
  Message,
  MessageContent,
  TokenUsage,
  Subagent,
  ConversationGroup,
  ContextStats,
  PricingRate,
} from 'claude-timeline-extractor/types'
```

## Links

- [GitHub Repository](https://github.com/abnersajr/claude-timeline)
- [Full Project README](https://github.com/abnersajr/claude-timeline/blob/main/README.md)

## License

MIT
