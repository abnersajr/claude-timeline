import type { Turn, TurnPricing } from "claude-timeline-types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Step {
  anchor: Turn
  tools: Turn[]
  toolNames: string[]
  totalCost: number
  totalOutput: number
  /** Per-step cost breakdown across 5 categories */
  inputCost: number
  outputCost: number
  cacheReadCost: number
  cacheCreation5mCost: number
  cacheCreation1hCost: number
}

export type StepTurnKind = "user" | "billed" | "tool"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function totalTokens(turn: Turn): number {
  const u = turn.tokenUsage
  return (
    u.inputTokens +
    u.outputTokens +
    u.cacheReadTokens +
    u.cacheCreation5mTokens +
    u.cacheCreation1hTokens
  )
}

function hasUserText(turn: Turn): boolean {
  return turn.messages.some(
    (m) =>
      m.type === "user" &&
      m.content.some(
        (c) =>
          c.type === "text" &&
          c.text &&
          !c.text.startsWith('{"type":"thinking"'),
      ),
  )
}

export function classifyStepTurn(turn: Turn): StepTurnKind {
  if (hasUserText(turn)) return "user"
  if (totalTokens(turn) > 0) return "billed"
  return "tool"
}

/** Extract a display name for a turn's tool call or message content. */
export function getStepToolName(turn: Turn): string | null {
  const firstTool = turn.toolCalls[0]
  if (firstTool) return firstTool.name
  for (const msg of turn.messages) {
    for (const block of msg.content) {
      if (block.type === "tool_use" && "name" in block && block.name)
        return String(block.name)
      if (block.type === "tool_result") return "result"
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Pricing accumulator helper
// ---------------------------------------------------------------------------

function accumulatePricing(step: Step, pricing: TurnPricing | undefined): void {
  if (!pricing) return
  step.totalCost += pricing.totalCost
  step.inputCost += pricing.inputCost
  step.outputCost += pricing.outputCost
  step.cacheReadCost += pricing.cacheReadCost
  step.cacheCreation5mCost += pricing.cacheCreation5mCost
  step.cacheCreation1hCost += pricing.cacheCreation1hCost
}

function newStep(anchor: Turn): Step {
  return {
    anchor,
    tools: [],
    toolNames: [],
    totalCost: 0,
    totalOutput: 0,
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheCreation5mCost: 0,
    cacheCreation1hCost: 0,
  }
}

// ---------------------------------------------------------------------------
// Step aggregates (token breakdown per step)
// ---------------------------------------------------------------------------

export interface StepAggregate {
  stepIndex: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreation5mTokens: number
  cacheCreation1hTokens: number
  totalTokens: number
  totalCost: number
  cumulativeCost: number
}

// ---------------------------------------------------------------------------
// Unified session steps builder
// ---------------------------------------------------------------------------

export interface SessionSteps {
  /** All steps (including zero-cost) */
  steps: Step[]
  /** Steps with totalCost > 0 (for Per-Step Cost table) */
  nonZeroCostSteps: Step[]
  /** Token aggregates per step (for Token Chart) */
  stepAggregates: StepAggregate[]
}

/**
 * Single entry point for all step-related data.
 * Call once per render, pass the result to all consumers.
 */
export function buildSessionSteps(
  turns: Turn[],
  turnsPricing: TurnPricing[],
): SessionSteps {
  const steps = buildSteps(turns, turnsPricing)
  const nonZeroCostSteps = steps.filter((s) => s.totalCost > 0)

  let cumulativeCost = 0
  const stepAggregates: StepAggregate[] = steps.map((step, i) => {
    const allTurns = [step.anchor, ...step.tools]
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheCreation5mTokens = 0
    let cacheCreation1hTokens = 0

    for (const turn of allTurns) {
      inputTokens += turn.tokenUsage.inputTokens
      outputTokens += turn.tokenUsage.outputTokens
      cacheReadTokens += turn.tokenUsage.cacheReadTokens
      cacheCreation5mTokens += turn.tokenUsage.cacheCreation5mTokens
      cacheCreation1hTokens += turn.tokenUsage.cacheCreation1hTokens
    }

    const totalTokens =
      inputTokens +
      outputTokens +
      cacheReadTokens +
      cacheCreation5mTokens +
      cacheCreation1hTokens
    cumulativeCost += step.totalCost

    return {
      stepIndex: i,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreation5mTokens,
      cacheCreation1hTokens,
      totalTokens,
      totalCost: step.totalCost,
      cumulativeCost,
    }
  })

  return { steps, nonZeroCostSteps, stepAggregates }
}

/**
 * Compute per-group step offsets for global step numbering.
 * Each offset is the cumulative step count before that group.
 */
export function computeGroupStepOffsets(
  groups: { turns: Turn[]; startIndex: number }[],
  allTurnsPricing: TurnPricing[],
): number[] {
  const offsets: number[] = []
  let cumulative = 0
  for (const group of groups) {
    offsets.push(cumulative)
    const grpPricing = allTurnsPricing.slice(
      group.startIndex,
      group.startIndex + group.turns.length,
    )
    cumulative += buildSteps(group.turns, grpPricing).length
  }
  return offsets
}

// ---------------------------------------------------------------------------
// Build steps (internal)
// ---------------------------------------------------------------------------

function buildSteps(
  turns: Turn[],
  turnsPricing: TurnPricing[],
): Step[] {
  const steps: Step[] = []
  let current: Step | null = null

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]
    if (!turn) continue
    const kind = classifyStepTurn(turn)
    const pricing = turnsPricing[i]

    if (kind === "user" || kind === "billed") {
      // New step
      current = newStep(turn)
      accumulatePricing(current, pricing)
      current.totalOutput += turn.tokenUsage.outputTokens
      steps.push(current)
    } else {
      // tool turn
      if (!current) {
        // Orphan tool result
        current = newStep(turn)
        accumulatePricing(current, pricing)
        steps.push(current)
      } else {
        current.tools.push(turn)
        accumulatePricing(current, pricing)
      }
    }
  }

  // Derive toolNames for each step
  for (const step of steps) {
    const names: string[] = []
    for (const t of step.tools) {
      const name = getStepToolName(t)
      if (name) names.push(name)
    }
    step.toolNames = names
  }

  return steps
}
