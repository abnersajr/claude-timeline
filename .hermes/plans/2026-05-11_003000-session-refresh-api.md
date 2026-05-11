# Session Refresh/Extract Trigger API

## Goal
Add a `POST /api/sessions/:id/refresh` endpoint so the Web can explicitly trigger a re-extraction of a session, and fix the cache to track JSONL mtime (not just SQLite mtime).

## Context

### Current extraction flow
```
GET /api/sessions/:id
  → SessionCache.get(sessionId, dbPath)
    → checks statSync(dbPath).mtimeMs (SQLite only)
    → stale → cache.delete(sessionId)
  → extractFullTimeline(sessionId, dbPath, projectsDir)
    → reads SQLite (getSession + getTurns)
    → finds + reads + parses FULL JSONL file
    → merges turns ↔ messages (O(turns × messages))
    → pricing, context stats, conversation groups
  → SessionCache.set(sessionId, data, dbPath)
```

### Problem
1. **No explicit refresh** — Web can only wait for React Query's 30s staleTime, then refetch. There's no way to say "I know this session changed, re-extract now."
2. **Cache only tracks SQLite mtime** — if a session is ongoing and JSONL is growing, the cache doesn't notice. Only detects changes when SQLite is written.
3. **Ongoing sessions** — the `isOngoing` flag is computed but not used for any automatic refresh behavior.

### Why NOT incremental extraction
Full recheck is fine. Sessions are <100 turns, extraction takes ~10-50ms, single-user local tool. Incremental would add significant complexity (byte offset tracking, partial merge state, JSONL truncation races) for negligible performance gain.

## Design

### New endpoint: `POST /api/sessions/:id/refresh`

```
POST /api/sessions/:id/refresh
→ bust cache for sessionId (regardless of mtime)
→ run extractFullTimeline(sessionId, dbPath, projectsDir)
→ set cache with current mtime
→ return FullTimelineSession
```

**Response**: same shape as `GET /api/sessions/:id` (FullTimelineSession) — no wrapper needed.

**Error cases**:
- 404 if session not found (same as GET)
- 500 if extraction fails (same as GET)

### Cache fix: track both SQLite and JSONL mtime

Update `SessionCache` to track the JSONL file's mtime alongside SQLite:

```typescript
interface CacheEntry {
  data: FullTimelineSession
  sqliteMtimeMs: number
  jsonlMtimeMs: number   // NEW — 0 if no JSONL file
}
```

Update `get()` to check both mtimes:
```typescript
get(sessionId: string, dbPath: string, jsonlMtimeMs?: number): FullTimelineSession | null {
  const entry = this.cache.get(sessionId)
  if (!entry) return null

  const currentSqliteMtime = this.getMtime(dbPath)
  if (currentSqliteMtime > entry.sqliteMtimeMs) {
    this.cache.delete(sessionId)
    return null
  }

  // Also check JSONL mtime if available
  if (jsonlMtimeMs !== undefined && jsonlMtimeMs > entry.jsonlMtimeMs) {
    this.cache.delete(sessionId)
    return null
  }

  return entry.data
}
```

Update `set()` to store both mtimes:
```typescript
set(sessionId: string, data: FullTimelineSession, dbPath: string, jsonlMtimeMs: number): void {
  this.cache.set(sessionId, {
    data,
    sqliteMtimeMs: this.getMtime(dbPath),
    jsonlMtimeMs,
  })
}
```

### Web integration: refresh button + ongoing session polling

**Web-side API client** (`web/src/lib/api.ts`):
```typescript
export async function refreshSession(id: string): Promise<FullTimelineSession> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}/refresh`, { method: "POST" })
  if (!res.ok) throw new Error(`Failed to refresh session: ${res.status}`)
  return res.json()
}
```

**Web-side query invalidation** — call after refresh:
```typescript
import { useQueryClient } from "@tanstack/react-query"

const queryClient = useQueryClient()

async function handleRefresh(sessionId: string) {
  const freshData = await refreshSession(sessionId)
  // Update React Query cache directly with the fresh response
  queryClient.setQueryData(["session", sessionId], freshData)
}
```

**Ongoing session polling** (optional, lower priority):
- Sessions with `isOngoing: true` could poll `POST /refresh` every 30-60s
- Use `useQuery` with `refetchInterval` conditional on `isOngoing`
- Stop polling when session ends (`isOngoing: false`)

## Files to Change

### API layer
1. **`api/src/cache.ts`** — add `jsonlMtimeMs` to `CacheEntry`, update `get()` and `set()` signatures
2. **`api/src/routes/sessions.ts`** — add `POST /sessions/:id/refresh` handler; update GET handler to pass JSONL mtime to cache
3. **`api/src/schemas/sessions.ts`** — no change needed (response shape unchanged)

### Extractor layer
4. **`extractor/src/utils.ts`** — add `getJsonlMtime(session, projectsDir)` helper that stat()s the JSONL file

### Web layer
5. **`web/src/lib/api.ts`** — add `refreshSession()` function

### Tests
6. **`api/tests/sessions.test.ts`** — add tests for:
   - `POST /sessions/:id/refresh` returns fresh data
   - `POST /sessions/:id/refresh` busts cache (second call returns new data after source changes)
   - `POST /sessions/:id/refresh` returns 404 for unknown session

## Implementation Order

1. Fix `SessionCache` to track JSONL mtime (cache.ts + utils.ts)
2. Update existing GET handler to pass JSONL mtime (sessions route)
3. Add `POST /sessions/:id/refresh` endpoint (sessions route)
4. Add `refreshSession()` to Web API client (api.ts)
5. Add tests (sessions.test.ts)
6. Update hand-written OpenAPI spec (openapi.yaml)
7. Update Bruno collection with refresh request

## Verification

1. `cd extractor && npx tsc` — rebuild after utils change
2. `cd api && pnpm test` — run integration tests
3. Manual test: start dev server, open Web, open a session, run `POST /refresh`, verify fresh data returned
4. Test cache invalidation: modify a JSONL file, call GET (should see new data without POST refresh)

## Risks / Tradeoffs

- **Race condition on ongoing sessions**: JSONL might be mid-write when we stat/parse it. This is the same risk as the current GET handler — not new. The JSONL parser already handles malformed lines gracefully.
- **No rate limiting on refresh**: A Web client could hammer the endpoint. Acceptable for single-user local tool; add rate limiting if it becomes multi-user.
- **JSONL mtime tracking adds a stat() call per GET**: Negligible overhead (microseconds for local filesystem).

---

## Implementation Status (2026-05-11)

### ✅ Implemented
1. `POST /api/sessions/:id/refresh` — busts cache + re-extracts
2. `SessionCache.delete()` — new method for explicit cache busting
3. `refreshSession()` — Web API client function
4. **Refresh button in sidebar** — appears on session pages, calls POST /refresh, updates React Query cache
5. **Auto-polling for ongoing sessions** — `refetchInterval: 5000` when `isOngoing`, stops when completed

### Files Changed
- `api/src/cache.ts` — added `delete()` method
- `api/src/routes/sessions.ts` — added `POST /sessions/:id/refresh` handler
- `web/src/lib/api.ts` — added `refreshSession()` function
- `web/src/components/layout/sidebar.tsx` — refresh button with spinning icon
- `web/src/routes/$sessionId.tsx` — auto-polling via `refetchInterval`

### Skipped (deferred)
- JSONL mtime tracking in cache — nice-to-have, the refresh endpoint covers the use case
- OpenAPI spec update — manual, do when cutting a release
- Bruno collection update — manual, do when cutting a release

---

## Live Session Design Analysis

### What "live session" means
The user wants to see a Claude Code session updating in real-time as it runs — new turns, tool calls, and costs appearing without manual refresh.

### Option A: Client-Side Polling (✅ IMPLEMENTED)
```
Web (React Query)
  → refetchInterval: 5000ms (when isOngoing)
  → GET /api/sessions/:id
  → API cache checks SQLite mtime → re-extracts if stale
  → returns updated FullTimelineSession
  → React re-renders
```

**Pros**: Simple, already implemented, works with existing architecture
**Cons**: 5s latency, wasted requests when nothing changed, server re-extracts even when data hasn't changed

### Option B: Server-Sent Events (SSE)
```
Web (EventSource)
  → GET /api/sessions/:id/stream
  → Server watches JSONL file (fs.watch or polling)
  → On new lines: parse delta, send event
  → Web patches React Query cache incrementally
```

**Pros**: True real-time (<1s latency), no wasted requests, efficient
**Cons**:
- New SSE endpoint on API
- Server-side file watching (fs.watch is unreliable across platforms)
- Delta parsing — need to track byte offset, parse only new lines
- Web needs to merge deltas into existing state
- Connection management (reconnect on drop)
- ~50-80 lines of new code across API + Web

### Option C: Hybrid — Poll metadata, fetch full on change
```
Web
  → Poll GET /api/sessions/:id/meta every 3s (lightweight: turnCount only)
  → When turnCount changes → fetch full session
```

**Pros**: Cheap polling, full data only when needed
**Cons**: Still two requests, metadata endpoint needed, complexity for marginal gain

### Recommendation

**Option A (polling) is the right choice for this project.** Here's why:

| Factor | Value |
|---|---|
| Session duration | 5-30 min typically |
| Turn frequency | 1 turn every 10-30s |
| User base | Single user, local |
| Extraction cost | ~10-50ms per full re-extract |
| Latency requirement | 5s is fine — user isn't watching like a stock ticker |

The 5s polling interval matches Claude Code's turn frequency well. The extraction is cheap enough that wasted requests are negligible. SSE would add ~50-80 lines of code and new failure modes (connection drops, delta parsing bugs) for maybe 3-4s latency improvement — not worth it.

**When SSE WOULD make sense**: if this became a multi-user service, or if sessions had 500+ turns where re-extraction is expensive, or if sub-second latency was critical.

### Implementation Details (Option A — Done)

The `refetchInterval` callback in React Query checks `query.state.data?.session.isOngoing`:
- `isOngoing === true` → poll every 5s
- `isOngoing === false` → stop polling (`return false`)

The sidebar refresh button calls `POST /refresh` which busts the API cache and re-extracts, giving immediate results regardless of the polling cycle.
