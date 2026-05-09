# Streaming Parser Integration Plan

## Why Streaming Parsing?
Current modular extractor (Approach2) uses in-memory parsing for JSONL and SQLite. Streaming parsing addresses:
1. **Large sessions**: 1000+ turn sessions where in-memory JSONL parsing uses excessive RAM
2. **Low latency**: Start processing before entire file is read (useful for WebUI real-time rendering)
3. **Future WebUI**: Stream partial results to browser as they're parsed
4. **Parallel multi-session**: Process multiple sessions concurrently with bounded memory

## Current Module Structure (Compatible)
```
src/
  jsonl-parser.ts    # Current: read entire file, parse all lines, return full objects
  db-reader.ts       # Current: SQLite queries (small data, no streaming needed yet)
  merger.ts          # Merges in-memory objects
```

## Integration Strategy
### 1. Interface Compatibility
Keep existing `jsonl-parser.ts` interface, add streaming alternative with same input/output contract:

**Current interface (jsonl-parser.ts):**
```typescript
export function parseSessionJsonl(
  jsonlPath: string,
  sessionId: string
): { messages: Message[]; toolCalls: ToolCall[] } {
  // Read entire file, parse all lines, return full arrays
}
```

**Streaming interface (streaming-jsonl-parser.ts):**
```typescript
export async function streamParseSessionJsonl(
  jsonlPath: string,
  sessionId: string,
  onChunk: (chunk: { messages: Message[]; toolCalls: ToolCall[] }) => void
): Promise<void> {
  // Read line-by-line, emit chunks as parsed
}
```

### 2. Module Replacement
- Keep original `jsonl-parser.ts` as default (simple, works for 99% of sessions)
- Add `streaming-jsonl-parser.ts` as optional upgrade
- Update `merger.ts` to accept either in-memory or streaming input
- Add config flag: `useStreaming: boolean` (default: false)

### 3. Implementation Steps
#### Step1: Line-by-Line JSONL Reading
Use Node.js `readline` or `split2` for line-based streaming:
```typescript
import { createInterface } from 'readline';
import { createReadStream } from 'fs';

async function streamJsonl(path: string, sessionId: string, onLine: (obj: any) => void) {
  const stream = createReadStream(path);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    if (obj.session_id === sessionId || !sessionId) onLine(obj);
  }
}
```

#### Step2: Chunked Emission
Emit chunks every N lines (e.g., 100 lines) to balance throughput and latency:
```typescript
const CHUNK_SIZE = 100;
let messageBuffer: Message[] = [];
let toolCallBuffer: ToolCall[] = [];

for await (const line of rl) {
  // Parse line, add to buffers
  if (messageBuffer.length >= CHUNK_SIZE) {
    onChunk({ messages: messageBuffer, toolCalls: toolCallBuffer });
    messageBuffer = [];
    toolCallBuffer = [];
  }
}
// Emit remaining
if (messageBuffer.length) onChunk({ messages: messageBuffer, toolCalls: toolCallBuffer });
```

#### Step3: SQLite Streaming (Optional)
SQLite turns table is small per session (~28 rows for example session). Streaming not needed yet, but for 1000+ turn sessions:
- Use `sqlite3` package with streaming query API
- Or paginate with `LIMIT/OFFSET` in `db-reader.ts`

### 4. Scalability to Multiple Sessions
For parallel multi-session extraction:
```typescript
async function extractMultipleSessions(sessionIds: string[], useStreaming = false) {
  if (useStreaming) {
    // Parallel streaming: each session streams independently
    return Promise.all(
      sessionIds.map(id => streamParseSessionJsonl(/*...*/))
    );
  } else {
    // Parallel in-memory: same as above, but load full files
    return Promise.all(
      sessionIds.map(id => parseSessionJsonl(/*...*/))
    );
  }
}
```

### 5. WebUI Integration
Streaming parser enables real-time timeline rendering:
1. Extractor streams JSON chunks to WebUI via WebSocket/SSE
2. WebUI renders messages/tool calls as they arrive
3. No need to wait for full session parse

## Migration Path
1. **Phase1 (Current)**: In-memory parsing, single session, JSON output
2. **Phase2 (CLI)**: Add `--use-streaming` flag for large sessions
3. **Phase3 (WebUI)**: Default to streaming, real-time rendering
4. **Phase4 (Scale)**: Parallel multi-session streaming with worker threads

## Tradeoffs
| Approach | Pros | Cons |
|----------|------|------|
| In-memory (current) | Simple, fast for small sessions, easy to debug | High memory for 1000+ turn sessions |
| Streaming (future) | Low memory, real-time capable, scalable | More complex, chunk boundary handling, harder to debug |
| Hybrid (recommended) | Best of both, default to in-memory, opt-in streaming | Two code paths to maintain |

**Recommendation**: Keep in-memory as default, add streaming as opt-in for large sessions.
