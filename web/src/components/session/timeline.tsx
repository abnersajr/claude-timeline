import type { Turn, TurnPricing } from "@timeline/types"
import type { Subagent } from "@timeline/types"
import { cn } from "@/lib/utils"
import { TurnCard } from "./turn-card"
import { SubagentCard } from "./subagent-card"

interface TimelineProps {
  turns: Turn[]
  turnsPricing: TurnPricing[]
  subagents?: Subagent[]
  className?: string
}

/**
 * Interleave turns and subagents by timestamp.
 * Returns an ordered list of items where each is either a turn or a subagent.
 */
function interleaveItems(turns: Turn[], subagents: Subagent[]) {
  const items: (
    | { kind: "turn"; turn: Turn; index: number }
    | { kind: "subagent"; subagent: Subagent }
  )[] = []

  let turnIdx = 0
  let subIdx = 0

  while (turnIdx < turns.length || subIdx < subagents.length) {
    const turn = turns[turnIdx]
    const sub = subagents[subIdx]

    if (subIdx >= subagents.length) {
      // Only turns left
      items.push({ kind: "turn", turn, index: turnIdx })
      turnIdx++
    } else if (turnIdx >= turns.length) {
      // Only subagents left
      items.push({ kind: "subagent", subagent: sub })
      subIdx++
    } else {
      // Compare timestamps — subagent spawns at startTime
      const turnTime = new Date(turn.timestamp).getTime()
      const subTime = new Date(sub.startTime).getTime()

      if (turnTime <= subTime) {
        items.push({ kind: "turn", turn, index: turnIdx })
        turnIdx++
      } else {
        items.push({ kind: "subagent", subagent: sub })
        subIdx++
      }
    }
  }

  return items
}

export function Timeline({ turns, turnsPricing, subagents, className }: TimelineProps) {
  if (turns.length === 0) {
    return (
      <div className={cn("py-12 text-center text-muted-foreground", className)}>
        No turns recorded for this session.
      </div>
    )
  }

  const hasSubagents = subagents && subagents.length > 0
  const items = hasSubagents ? interleaveItems(turns, subagents) : null

  return (
    <div className={cn("relative", className)}>
      {/* Vertical timeline line */}
      <div className="absolute left-0 top-0 bottom-0 w-px bg-border" />

      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        Timeline ({turns.length} turns{hasSubagents ? `, ${subagents.length} subagents` : ""})
      </h3>

      {/* Interleaved items */}
      <div className="ml-4 space-y-4">
        {items
          ? items.map((item, i) => {
              if (item.kind === "turn") {
                return (
                  <TurnCard
                    key={item.turn.timestamp}
                    turn={item.turn}
                    pricing={turnsPricing[item.index]}
                    index={item.index}
                  />
                )
              }
              return (
                <SubagentCard
                  key={item.subagent.id}
                  subagent={{
                    id: item.subagent.id,
                    description: item.subagent.description,
                    status:
                      item.subagent.status === "pending"
                        ? "running"
                        : item.subagent.status,
                    turns: item.subagent.turnCount,
                    tokens: item.subagent.totalTokens
                      ? item.subagent.totalTokens.inputTokens +
                        item.subagent.totalTokens.outputTokens +
                        item.subagent.totalTokens.cacheReadTokens +
                        item.subagent.totalTokens.cacheCreationTokens
                      : 0,
                    durationMs:
                      new Date(item.subagent.endTime).getTime() -
                      new Date(item.subagent.startTime).getTime(),
                    model: item.subagent.model,
                  }}
                  className="bg-muted/30"
                />
              )
            })
          : turns.map((turn, i) => (
              <TurnCard
                key={turn.timestamp}
                turn={turn}
                pricing={turnsPricing[i]}
                index={i}
              />
            ))}
      </div>
    </div>
  )
}
