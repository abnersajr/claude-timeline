import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function formatCost(n: number): string {
  return `$${n.toFixed(3)}`
}

/**
 * Format milliseconds as a human-readable duration.
 * Uses minutes and seconds (not fractional minutes).
 * Examples: 114000 → '1m 54s', 3000 → '3s', 450000 → '7m 30s'
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`

  const seconds = Math.floor((ms % 60_000) / 1_000)
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (seconds > 0) parts.push(`${seconds}s`)

  return parts.length > 0 ? parts.join(' ') : '0s'
}

/**
 * Format milliseconds as hours and minutes (no seconds).
 * Examples: 114000 → '1h 54m', 45000 → '0m' (but shows '1m' for 60s+),
 * 180000 → '3m', 4500000 → '1h 15m'
 */
export function formatDurationHm(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return '< 1m'
}

export function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export type ModelTier = "opus" | "sonnet" | "haiku" | "unknown"

export function modelTier(model: string): ModelTier {
  const m = (model || '').toLowerCase()
  if (m.includes('opus')) return 'opus'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('haiku')) return 'haiku'
  return 'unknown'
}
