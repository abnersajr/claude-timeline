# Cost Breakdown — Per-Step Redesign

> **Status:** Approved (2026-05-11)
> **Depends on:** `docs/design/step-grouping.md`
> **Scope:** `web/src/components/session/cost-breakdown.tsx`

## Problem

The current **Per-Turn Cost** table renders all 45 turns from a session. 26 of them (58%) are
zero-cost noise — tool results, user messages, and empty turns that carry no billing data.

### Noise sources

| Source | Count | Why zero cost |
|---|---|---|
| Tool result turns | 18 | Tokens billed on the request that triggered the tool, not the result |
| User message turns | 2 | Tokens billed on the model's response, not the user's input |
| Empty assistant turns | 6 | Extractor noise — zero content blocks, zero tokens, duplicate timestamps |

These turns are correct API protocol representations but carry no billing information.
They belong in the timeline (for debugging) but not in the cost breakdown.

## Design

### Replace Per-Turn with Per-Step

Apply the same step grouping from the timeline (`buildSteps()`). Each step = one billed
API request + its tool executions. Filter out zero-cost steps.

### Table layout

```
Step   Input    Output   CacheR   CW5m     CW1h     Total    Cumul.
S1     $0.000   $0.002   $0.004   $0.000   $0.102   $0.108   $0.108
S2     $0.000   $0.003   $0.009   $0.000   $0.005   $0.016   $0.124
S3     $0.000   $0.002   $0.009   $0.000   $0.004   $0.014   $0.138
S4     $0.000   $0.002   $0.009   $0.000   $0.003   $0.015   $0.153
...
```

- **3 decimal places** (`$0.000` format)
- **5 separate cost columns**: Input, Output, Cache Read, Cache Write 5m, Cache Write 1h
  — matches the bar chart categories exactly
- **Cumulative column**: running total across steps
- **Zero-cost steps omitted** (user turns, tool results absorbed into their parent step)
- **Step row clickable** → scrolls to and highlights the matching step in the timeline above

### Anchor linking (scrollTo)

When the user clicks a step row in the Cost Breakdown table:

1. The timeline's corresponding step gets a brief highlight (e.g., 2s yellow flash)
2. The page scrolls to bring that step into view
3. Implementation: each step in the timeline gets `id="step-S1"`, the cost table row
   links to `#step-S1`

This creates a bidirectional connection: the user can go from "which step was expensive?"
(cost table) → "what happened in that step?" (timeline).

### Sections to keep unchanged

- **Cost category bars** (Input/Output/CR/CW5m/CW1h with percentages) — stays as-is
- **Pricing Rate** section — stays as-is

## Data flow

```
pricing.turnsPricing[]  →  buildSteps(turns, turnsPricing)  →  filter(cost > 0)  →  render table
```

The `buildSteps()` function from `chat-timeline.tsx` should be extracted to a shared
utility (e.g., `lib/steps.ts`) so both components can import it.

## Implementation notes

- Extract `buildSteps()`, `classifyStepTurn()`, `totalTokens()` from `chat-timeline.tsx`
  into `web/src/lib/steps.ts`
- `CostBreakdown` imports `buildSteps` and uses it to group `turnsPricing` into steps
- Each step's cost = sum of `turnsPricing` for all turns in the step (anchor + tools)
- Cumulative = running sum across steps
- Step badge `S1`, `S2` etc. matches the timeline step numbering
- The scrollTo uses `element.scrollIntoView({ behavior: 'smooth', block: 'center' })`
- Highlight: add a temporary CSS class that fades out via `animation: flash 2s`

## Open questions

None.
