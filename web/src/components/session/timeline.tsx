import type { Turn, TurnPricing } from "@timeline/types"
import { cn } from "@/lib/utils"
import { TurnCard } from "./turn-card"

interface TimelineProps {
  turns: Turn[]
  turnsPricing: TurnPricing[]
  className?: string
}

export function Timeline({ turns, turnsPricing, className }: TimelineProps) {
  if (turns.length === 0) {
    return (
      <div className={cn("py-12 text-center text-text-muted", className)}>
        No turns recorded for this session.
      </div>
    )
  }

  return (
    <div className={cn("space-y-3", className)}>
      <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
        Timeline ({turns.length} turns)
      </h3>
      {turns.map((turn, i) => (
        <TurnCard
          key={turn.timestamp}
          turn={turn}
          pricing={turnsPricing[i]}
          index={i}
        />
      ))}
    </div>
  )
}
