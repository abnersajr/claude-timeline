# Timeline Step Grouping — Design Spec

> **Status:** Approved (2026-05-11)
> **Scope:** `web/src/components/session/chat-timeline.tsx`

## Problem

The Claude Code API emits granular turns — one API request can produce multiple turns (processing, tool_call, tool_result). The current UI renders **1 API turn = 1 row**, which creates visual noise:

```
T2: processing…                29.1k ctx  163 out
T3: ToolSearch                                $0.11
T4: processing…                29.9k ctx  167 out
T5: mcp__fff__multi_grep                      $0.02
T6: mcp__fff__grep            30.5k ctx  101 out
T7: result                                    $0.01
T8: processing…                31.1k ctx  157 out
T9: mcp__fff__grep                            $0.01
T10: mcp__fff__grep                           $0.00
T11: result                                   $0.01
T12: mcp__fff__grep                           $0.01
T13: result                                   $0.01
T14: mcp__fff__grep                           $0.01
T15: result                                   $0.01
```

14 rows for what is logically 4 billable API calls.

## Core Principle: Billing-Based Grouping

**A "step" = one billable API request + all its downstream tool executions.**

The signal for "this is a billed API request" is: the turn has non-zero token usage
(`inputTokens + outputTokens + cacheReadTokens + cacheCreation5mTokens + cacheCreation1hTokens > 0`).

Turns with all-zero token usage are **tool execution artifacts** — they represent tool
calls and results that were part of the same API request but got split into separate
turn entries by the extractor.

## Grouping Algorithm

```
steps = []
currentStep = null

for turn in turns:
    isBilled = totalTokens(turn) > 0

    if isBilled:
        # New step starts — this is a new API request
        currentStep = { anchor: turn, tools: [] }
        steps.push(currentStep)
    else:
        # Tool execution — attach to current step
        if currentStep:
            currentStep.tools.push(turn)
        else:
            # Orphan tool result (shouldn't happen, but handle gracefully)
            steps.push({ anchor: turn, tools: [] })
```

### Applied to the example above

| Step | Turns | What happened | Tokens | Cost |
|------|-------|---------------|--------|------|
| S1 | T2, T3 | thinking → ToolSearch | 29.1k ctx, 163 out | $0.11 |
| S2 | T4, T5 | thinking → multi_grep | 29.9k ctx, 167 out | $0.02 |
| S3 | T6, T7 | grep → result | 30.5k ctx, 101 out | $0.01 |
| S4 | T8–T15 | thinking → grep×4 + results | 31.1k ctx, 157 out | $0.05 |

14 rows → 4 steps.

## Turn Classification

Each turn in the API response falls into one of these categories:

| Category | Has tokens? | Has toolCalls? | Content blocks | Description |
|----------|-------------|----------------|----------------|-------------|
| `USER_TEXT` | no | no | user + text | User message (prompt, command) |
| `PROCESSING` | yes | no | assistant + empty | Model thinking, no tool call |
| `TOOL_CALL` | yes | yes | assistant + tool_use | Model called a tool (has output tokens from reasoning) |
| `TOOL_CALL_RESULT` | no | yes | assistant + tool_result | Tool call + result bundled in same turn |
| `TOOL_RESULT_ONLY` | no | no | assistant + tool_result | Result for a prior tool_use |
| `ASSISTANT_TEXT` | yes | no | assistant + text | Model produced user-visible output |

**Only `USER_TEXT` and turns with tokens > 0 start new steps.** Everything else accumulates.

## Rendering

### Collapsed (default)

Each step renders as a single row with:

- **Step badge:** `S1`, `S2`, etc.
- **Summary:** what happened — `thinking → ToolSearch`, `thinking → [grep ×4]`, `grep → result`
- **Tool pills:** colored badges for each tool name (clickable to expand)
- **Metrics:** aggregated context (max across steps, not summed), total output, total cost

```
S1  processing… → ToolSearch                          $0.11
S2  processing… → multi_grep                          $0.02
S3  grep → result                                     $0.01
S4  processing… → [grep, grep, grep, grep]  ×4 tools  $0.05
```

### Expanded (click to drill in)

The raw turns become visible, indented under the step:

```
S4  processing… → [grep, grep, grep, grep]  ×4 tools  $0.05
  ▼ T8   processing…                     31.1k ctx  157 out
    T9   mcp__fff__grep                                 $0.01
    T10  mcp__fff__grep                                 $0.00
    T11  result                                         $0.01
    T12  mcp__fff__grep                                 $0.01
    T13  result                                         $0.01
    T14  mcp__fff__grep                                 $0.01
    T15  result                                         $0.01
```

### Final output

The last step with `ASSISTANT_TEXT` gets special treatment — its text renders as the
agent output bubble (existing behavior). The step row still appears above it.

## Metric Aggregation Rules

Within a step:

- **Context:** use the `anchor` turn's context (the billed turn). It already includes
  all prior context — summing would double-count.
- **Output tokens:** sum across all turns in the step (only the anchor has non-zero).
- **Cost:** sum across all turns in the step (each tool call has its own cost).
- **Tool count:** count of `toolCalls[]` entries across all turns in the step.

## Implementation Notes

- **Frontend-only change.** No API or extractor changes. The raw turn granularity is
  preserved for debugging and future consumers.
- **Location:** `web/src/components/session/chat-timeline.tsx`
- The `ProcessingTurns` component already collapses T1–T{n-1}. Step grouping should
  replace the flat turn list inside that collapsed block.
- Step grouping applies **within** an interaction group (between user messages), not
  across them.
- The `ConversationGroup` data from the API is not used for step grouping — it groups
  at a higher level (user message boundaries).

## Open Questions

None — model and user agreed on billing-based grouping with frontend-only implementation.
