import { cn, formatTokens } from "@/lib/utils"

type TokenCategory = "input" | "output" | "cache-read" | "cache-write"

interface TokenBadgeProps {
  /** Raw token count */
  count: number
  /** Token category for color coding */
  category: TokenCategory
  /** Optional label override (defaults to category name) */
  label?: string
  className?: string
}

const categoryStyles: Record<TokenCategory, string> = {
  input: "bg-accent-blue/15 text-accent-blue",
  output: "bg-accent-green/15 text-accent-green",
  "cache-read": "bg-accent-amber/15 text-accent-amber",
  "cache-write": "bg-accent-purple/15 text-accent-purple",
}

const categoryLabels: Record<TokenCategory, string> = {
  input: "in",
  output: "out",
  "cache-read": "cache",
  "cache-write": "write",
}

export function TokenBadge({
  count,
  category,
  label,
  className,
}: TokenBadgeProps) {
  if (count === 0) return null

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        categoryStyles[category],
        className,
      )}
    >
      <span className="opacity-70">{label ?? categoryLabels[category]}</span>
      <span className="font-semibold">{formatTokens(count)}</span>
    </span>
  )
}

/** Compact row of token badges for a turn's token usage */
interface TokenBadgeGroupProps {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  className?: string
}

export function TokenBadgeGroup({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheCreationTokens,
  className,
}: TokenBadgeGroupProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <TokenBadge count={inputTokens} category="input" />
      <TokenBadge count={outputTokens} category="output" />
      {cacheReadTokens != null && cacheReadTokens > 0 && (
        <TokenBadge count={cacheReadTokens} category="cache-read" />
      )}
      {cacheCreationTokens != null && cacheCreationTokens > 0 && (
        <TokenBadge count={cacheCreationTokens} category="cache-write" />
      )}
    </div>
  )
}
