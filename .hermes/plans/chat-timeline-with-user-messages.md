# Full Timeline with User Messages + Chat UI

## Problem

User-typed messages (e.g., `/claude-hud:setup`, actual chat text) are missing from the timeline at every layer:

1. **Extractor**: Tool-result-only records (CLI bash output) are classified as "user" messages because `isMeta` is null/undefined. The `matchTurnsToMessages` function uses raw `m.type` (not classifier category) when assigning message types to turns. This means 26 tool_result records masquerade as "user" while only 2 actual user text records exist.

2. **Merger**: Each turn gets exactly ONE matched message (closest by timestamp within 5s). User text records compete with tool_result records for matching slots. The actual user message at `19:22:39` is 5.7s from the nearest turn (`19:22:45`) — just outside the window.

3. **Conversation Groups**: `buildConversationGroups` starts a new group when it sees `m.type === "user"`. Since tool_result records have type="user", they become the `userMessage` of groups. Actual user text is orphaned.

4. **Web UI**: The Timeline component shows flat turn cards, not a chat flow. No iMessage-style bubbles.

## Data Analysis (session 19500eaa)

| Record type | Count | isMeta | content |
|---|---|---|---|
| Tool results (CLI output) | 26 | null | array of tool_result |
| Plugin-generated text | 2 | true | array of text (long setup instructions) |
| **Actual user text** | **2** | **null** | **string** (slash commands) |

The 2 actual user text records:
- `19:22:39` → `/claude-hud:setup` (missed matching — 5.7s from nearest turn)
- `19:26:52` → `/claude-hud:configure` (matched to turn at `19:29:46` — wrong turn!)

## Fix Architecture

### Layer 1: Extractor (extractor/src/)

**A. classifier.ts** — Already fixed (isToolResultOnly check). Rebuild needed.

**B. merger.ts — `matchTurnsToMessages`** — 3 changes:

1. **Use classifier category for message type** instead of raw `m.type`:
   ```
   // Before: type: (m.type as "assistant" | "user" | "system") ?? "assistant"
   // After:  type: classifyMessage(m) === "user" ? "user" : "assistant"
   ```
   This ensures tool_result-only records get type="assistant" (they have content but are not user text).

2. **Two-pass matching with priority for user text**:
   - Pass 1: Match user text records (category="user") to turns with 10s window
   - Pass 2: Match remaining records (assistant, tool_result, etc.) to turns with 5s window
   This ensures user text gets first pick of turn slots.

3. **Handle unmatched user text**: If a user text record doesn't match any turn within 10s, create a synthetic turn for it (with zero tokens) so it still appears in the timeline.

**C. conversation-groups.ts** — No changes needed. Once merger fixes message types, the existing logic (new group on `m.type === "user"`) will correctly identify user text as group starters.

### Layer 2: API (api/src/)

No changes needed. The API returns `conversationGroups` which are built from the fixed turns.

### Layer 3: Web UI (web/src/)

**A. New component: `chat-timeline.tsx`**

iMessage-style chat bubbles:
- **User messages**: Right-aligned, blue/primary-tinted bubble, "You" label + timestamp
- **Assistant messages**: Left-aligned, muted bubble, header with:
  - Robot icon + "Claude" + model name
  - Tool call count + message count
  - Token usage badges (input/output/cache)
  - Cost + timestamp
- **Tool calls**: Compact pill list in assistant bubble, expandable to full ToolCallItem
- **Subagents**: Inline cards between messages, same as current SubagentCard

Uses `conversationGroups` from the API response as primary data source, falls back to `turns` if no groups.

**B. Update `$sessionId.tsx`**

Replace `<Timeline>` with `<ChatTimeline>`.

### Build & Deploy

After extractor changes:
1. `cd extractor && npx tsc`
2. Restart API: `kill $(lsof -i :3099 -t) && cd api && pnpm dev`

After web changes:
- Vite dev server auto-reloads

## File List

| File | Change |
|---|---|
| `extractor/src/merger.ts` | Use category for type, two-pass matching, synthetic turns |
| `extractor/src/classifier.ts` | Already fixed (isToolResultOnly) |
| `web/src/components/session/chat-timeline.tsx` | NEW: iMessage-style chat component |
| `web/src/routes/$sessionId.tsx` | Use ChatTimeline instead of Timeline |

## Verification

1. `curl localhost:3099/api/sessions/19500eaa-... | jq '.turns[] | select(.messages | any(.type == "user"))'` — should show user text, not tool_result
2. `curl ... | jq '.conversationGroups[] | select(.userMessage != null) | .userMessage.content[0].text'` — should show actual user text
3. Web UI shows user messages as right-aligned blue bubbles
