# Sub-Agent Support: Investigation & Plan

**Date**: 2026-05-12
**Session reference**: `3b6c79ee-6963-41c6-a66e-a2a15d8fba8a`
**Status**: Plan only — no implementation

---

## 1. Current State

### What works (data layer)
- **Extractor**: `subagent-locator.ts` discovers JSONL files, `subagent-resolver.ts` parses + links via 3-phase strategy (agentId → description → positional fallback)
- **Rich data extracted**: messages, toolCalls, totalTokens, model, startTime/endTime, turnCount, isParallel, status
- **meta.json** exists with `agentType` ("Explore", "general-purpose") and `description` — but **not used** by resolver (it extracts description from the JSONL first assistant text block instead)

### What's broken (UI layer)
| Gap | Severity | Detail |
|-----|----------|--------|
| **ChatTimeline ignores subagents** | 🔴 Critical | `subagents` prop accepted but never rendered. The primary view shows zero subagent data. |
| **No drill-down into subagent conversations** | 🔴 Critical | `messages` + `toolCalls` extracted but never displayed. Subagents are black boxes. |
| **SubagentCard is summary-only** | 🟡 Medium | Shows turns/tokens/duration/model but no tool calls, no message content, no cost. |
| **No inline timeline placement** | 🟡 Medium | Subagents should appear where the parent Task tool call was made, not in a separate section. |
| **No parallel execution visualization** | 🟡 Medium | `isParallel` detected but never shown. In session `3b6c79ee`, 3 subagents ran simultaneously — invisible. |
| **No subagent cost attribution** | 🟠 High | Subagent tokens aren't factored into session cost display. Session cost is understated. |
| **agentType from meta.json unused** | 🟢 Low | Could show "Explore" / "general-purpose" badges. |
| **parentTaskId never displayed** | 🟢 Low | Could link subagent back to the exact Task call. |
| **API schema: z.any()** | 🟢 Low | No validation on subagent shape — fragile. |

### Session `3b6c79ee` example
```
Parent session: 74 JSONL lines, Haiku model
├── Task tool call → "Explore the seat-selection-first module"
│   └── Subagent afd1132f (26 turns, 725K cache tokens, 66s) ← PARALLEL
├── Task tool call → "Explore the cart-related code"
│   └── Subagent ad63c36a (35 turns, 1.3M cache tokens, 87s) ← PARALLEL
├── Task tool call → "Explore the navigation and URL parameter handling"
│   └── Subagent a3e5e704 (40 turns, 1.4M cache tokens, 105s) ← PARALLEL
└── Task tool call → "Read these specific files completely"
    └── Subagent ab70d231 (3 turns, 54K cache tokens, 18s) ← SEQUENTIAL
```

---

## 2. Design Goals

1. **Subagents appear inline** in the ChatTimeline at the point where the parent Task tool call was made — not in a separate section
2. **Drill-down**: Click a subagent to expand its full conversation (messages + tool calls) using the same StepRow/TurnRow patterns as the parent timeline
3. **Parallel execution visible**: When subagents run concurrently, show them side-by-side or with a clear parallel indicator
4. **Cost attribution**: Subagent costs visible in both the subagent card and the parent session summary
5. **Meta.json data used**: agentType badge, description from meta.json (higher quality than JSONL-extracted)

---

## 3. UI Proposal

### 3a. Inline Subagent Placement with Connector Lines

Subagents appear inline within the parent's InteractionGroup, connected via
vertical + horizontal connector lines. The vertical line runs from the parent
Task tool call step down through all spawned subagents, then continues to the
next step.

**Single subagent (collapsed):**

```
  S1  Bash → [Glob, Read]                       ×3 tools
  │
  ▼
  │
  ├── ◆ "Explore cart code"  haiku-4-5  Done    ← collapsed card
  │     35 turns · 1.3M ctx · 45K out · $0.08
  │     └─ [Expand ▼]
  │
  ▼
  S3  Bash → [Write]                            ×1 tool
```

**Multiple subagents (parallel group, collapsed):**

```
  S1  Bash → [Glob, Read]                       ×3 tools
  │
  ▼
  │
  ├── ⚡ 3 parallel subagents                   ← parallel badge
  │   ├── ◆ "Explore seat-selection"  66s       ← collapsed card
  │   │     └─ [Expand ▼]
  │   ├── ◆ "Explore cart code"       87s       ← collapsed card
  │   │     └─ [Expand ▼]
  │   └── ◆ "Explore navigation"     105s       ← collapsed card
  │         └─ [Expand ▼]
  │
  ▼
  S3  Bash → [Write]                            ×1 tool
```

**Single subagent (expanded with drill-down):**

```
  ├── ◆ "Explore cart code"  haiku-4-5  Done
  │   │  35 turns · 1.3M ctx · 45K out · $0.08
  │   │
  │   ├── S1  Read → [Read, Read]               ← subagent step (reuses StepRow)
  │   │     └── T1  Read  12K ctx               ← expanded turn detail
  │   │     └── T2  Read  8K ctx
  │   │
  │   ├── S2  Grep → [Read, Read, Read]         ← subagent step
  │   │     └── T3  Grep  5K ctx
  │   │     └── T4  Read  3K ctx
  │   │
  │   └── S3  Read → [Glob]                     ← subagent step
  │         └── T5  Glob  2K ctx
  │
  │   [Collapse ▲]
  │
  ▼
  S3  Bash → [Write]
```

**Connector line rules:**
- Vertical `│` line runs from the parent step down through all subagent cards
- Horizontal `├──` branches connect each subagent card to the vertical line
- `▼` arrow marks the continuation point below the subagent group
- The vertical line uses `border-l-2 border-dashed border-muted-foreground/30`
- Horizontal connectors use `border-t-2 border-dashed border-muted-foreground/30`
- Arrow `▼` uses the existing chevron SVG rotated 90°

### 3b. Subagent Card (collapsed)

Each subagent card is independently collapsible:
- Header: chevron + agentType badge + description + model + status badge
- Summary line: turn count · total context · output tokens · cost
- Expand toggle to show full drill-down

### 3c. Subagent Card (expanded)

When expanded, shows the subagent's own timeline using the same StepRow/TurnRow
patterns as the parent timeline:
- Subagent steps labeled with its own S1, S2, ...
- Each step expandable to show turn details (tool inputs, results, text)
- Full content, no truncation (invariant #10)

### 3d. Parent Group Summary

In the parent InteractionGroup's GroupSummary, add subagent totals:

```
  128K context · 32K output · 12 tool calls · $0.42 · 4 subagents ($0.14)
```

### 3e. Cost Attribution

- Subagent costs calculated using the same `calculateTurnCost` logic
- Shown in: subagent card header, parent group summary, session-level summary
- Subagent cost is additive — parent session total includes subagent costs

---

## 4. Implementation Plan

### Phase 1: Data Layer Fixes (Extractor)

**1.1 Use meta.json for agentType and description**
- File: `extractor/src/subagent-resolver.ts`
- In `parseSubagentFile()`: read `{agentId}.meta.json` alongside JSONL
- Add `agentType` field to `Subagent` type
- Prefer meta.json description over JSONL-extracted (higher quality, user-facing)
- File: `extractor/src/types.ts` — add `agentType?: string` to `Subagent`

**1.2 Calculate subagent costs**
- File: `extractor/src/subagent-resolver.ts`
- Import `calculateTurnCost` from `pricing.ts`
- After parsing, compute per-turn costs using subagent model + token data
- Add `totalCost: number` to `Subagent` type
- Add `turnsPricing: TurnPricing[]` to `Subagent` type (same pattern as parent)

**1.3 Link subagent to parent turn index**
- File: `extractor/src/merger.ts`
- After `resolveSubagents()`, match each subagent's `parentTaskId` to a turn index
- Add `parentTurnIndex: number` to `Subagent` type
- This enables the UI to place subagents inline at the correct position

**1.4 API schema**
- File: `api/src/schemas/sessions.ts`
- Replace `z.array(z.any())` with a proper SubagentSchema (or at minimum z.object with known fields)

### Phase 2: UI — Inline Subagent Cards

**2.1 SubagentTimelineStep component**
- File: `web/src/components/session/subagent-timeline-step.tsx` (new)
- Renders an inline subagent card within a step's tool list
- Shows: agentType badge, description, turn count, tokens, duration, cost, model
- Expandable: shows subagent's own steps/turns when clicked
- Reuses `StepRow`, `TurnRow`, `ToolCallList` patterns from chat-timeline

**2.2 Parallel subagent group**
- File: `web/src/components/session/subagent-timeline-step.tsx`
- When multiple subagents have overlapping time ranges (isParallel), render as a stacked group
- "⚡ N parallel subagents" header with expandable list
- Each subagent in the group is independently expandable

**2.3 Integrate into ChatTimeline**
- File: `web/src/components/session/chat-timeline.tsx`
- In `InteractionGroup`: match subagents to turns via `parentTurnIndex`
- At the matching turn's step, render `SubagentTimelineStep` instead of (or alongside) the Task tool call
- Pass subagent data through the step rendering pipeline

**2.4 Update GroupSummary**
- File: `web/src/components/session/chat-timeline.tsx`
- Add subagent count and cost to the summary bar
- Pattern: `128K context · 32K output · 12 tool calls · $0.42 · 4 subs ($0.14)`

### Phase 3: Polish

**3.1 Remove old Timeline subagent rendering**
- File: `web/src/components/session/timeline.tsx`
- The old `interleaveItems` approach is superseded by inline placement
- Keep `SubagentCard` as a fallback or remove if fully replaced

**3.2 Subagent card refinements**
- File: `web/src/components/session/subagent-card.tsx`
- Add agentType badge (from meta.json)
- Add cost display
- Improve parallel indicator styling

**3.3 Tests**
- `extractor/src/subagent-resolver.test.ts` — add tests for meta.json parsing, cost calculation, parentTurnIndex
- `web/src/components/session/subagent-timeline-step.test.tsx` — component tests for inline rendering, parallel grouping

---

## 5. Files to Change

| File | Change | Phase |
|------|--------|-------|
| `extractor/src/types.ts` | Add `agentType`, `totalCost`, `turnsPricing`, `parentTurnIndex` to `Subagent` | 1 |
| `extractor/src/subagent-resolver.ts` | Read meta.json, compute costs, return enriched Subagent | 1 |
| `extractor/src/merger.ts` | Add parentTurnIndex linking after resolveSubagents | 1 |
| `api/src/schemas/sessions.ts` | SubagentSchema with proper validation | 1 |
| `web/src/components/session/subagent-timeline-step.tsx` | **New** — inline subagent card + parallel group | 2 |
| `web/src/components/session/chat-timeline.tsx` | Render subagents inline at Task tool call steps, update GroupSummary | 2 |
| `web/src/components/session/subagent-card.tsx` | Add agentType, cost, parallel indicator | 3 |
| `web/src/components/session/timeline.tsx` | Remove old interleaving (or keep as fallback) | 3 |
| `extractor/src/subagent-resolver.test.ts` | New tests for meta.json, costs, parentTurnIndex | 3 |

---

## 6. Open Questions

1. **Drill-down depth**: Should expanding a subagent show ALL its turns with full tool I/O, or just a summary? (I propose full drill-down — the data is already extracted)

2. **Cost model**: Subagent turns use their own model (Haiku in the example). Should the session-level cost breakdown show subagent costs as a separate line item, or folded into the parent?

3. **Nested subagents**: Claude Code doesn't currently nest sub-sub-agents, but should the UI handle it if it ever does? (I propose no — keep it flat for now)

4. **meta.json availability**: The meta.json files are small and always present alongside JSONL. Should we fall back to JSONL-extracted description if meta.json is missing? (I propose yes — graceful degradation)

5. **Parallel visualization**: Side-by-side columns vs stacked cards? (I propose stacked — simpler layout, works on mobile)

---

## 7. Risks

- **Extractor cost calculation**: Subagent turns don't go through the SQLite path (no usage.db entries). Costs must be computed purely from JSONL token data. The pricing tables are available, so this should work, but edge cases (unknown models, missing token fields) need testing.
- **Parent turn matching**: The `parentTaskId → turnIndex` mapping depends on the Task tool call being present in the parent's toolCalls. If the Task call was filtered as noise or deduped away, the subagent won't get an inline position. Fallback: show in a separate section below the timeline.
- **Large subagents**: Some subagents have 40+ turns. Expanding them inline could make the parent timeline very long. Consider lazy-loading or virtual scrolling for the expanded content.
