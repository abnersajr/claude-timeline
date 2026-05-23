"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

interface CollapsibleResultProps {
  /** Label shown next to the chevron (e.g. "Result", "Result (3)") */
  label: string
  /** The full text content to display */
  content: string
  /** Optional error badge */
  isError?: boolean
  /** Additional classes for the outer container */
  className?: string
  /** Chevron/label color classes */
  labelClassName?: string
}

export function CollapsibleResult({
  label,
  content,
  isError,
  className,
  labelClassName = "text-muted-foreground hover:text-foreground",
}: CollapsibleResultProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "mb-1 flex cursor-pointer items-center gap-1.5 text-sm font-medium uppercase tracking-wider transition-colors",
          labelClassName,
        )}
      >
        <svg
          className={cn(
            "h-3 w-3 flex-shrink-0 transition-transform",
            open && "rotate-90",
          )}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        {label}
        {isError && (
          <span className="rounded bg-red-500/15 px-1 py-0.5 text-red-500">
            error
          </span>
        )}
      </button>
      {open && (
        <pre className="blur-sensitive max-h-[500px] resize-y overflow-auto rounded-md bg-accent p-2.5 font-mono text-xs text-muted-foreground whitespace-pre-wrap break-all">
          {content}
        </pre>
      )}
    </div>
  )
}
