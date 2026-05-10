import * as React from "react";
import { cn } from "../../lib/utils";
import { formatTokens, formatDuration } from "../../lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubagentStatus = "running" | "completed" | "failed" | "cancelled"

export interface SubagentSession {
  /** Unique subagent session ID (e.g. "sa_a1b2c3d4") */
  id: string;
  /** Short description of what the subagent is doing */
  description: string;
  /** Current status */
  status: SubagentStatus;
  /** Number of conversation turns */
  turns: number;
  /** Total tokens consumed (input + output) */
  tokens: number;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
  /** Optional: model used by the subagent */
  model?: string;
  /** Optional: error message if status is "failed" */
  error?: string;
}

// ---------------------------------------------------------------------------
// Status badge colors
// ---------------------------------------------------------------------------

const statusStyles: Record<SubagentStatus, string> = {
  running: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  cancelled: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
};

const statusLabels: Record<SubagentStatus, string> = {
  running: "Running",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

// ---------------------------------------------------------------------------
// SubagentCard
// ---------------------------------------------------------------------------

interface SubagentCardProps {
  subagent: SubagentSession;
  /** Whether the card starts expanded (default: false) */
  defaultOpen?: boolean;
  className?: string;
}

export function SubagentCard({
  subagent,
  defaultOpen = false,
  className,
}: SubagentCardProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground shadow-sm transition-colors",
        open ? "border-border" : "border-border/50 hover:border-border",
        className
      )}
    >
      {/* Header — always visible, clickable to toggle */}
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {/* Chevron */}
        <svg
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" />
        </svg>

        {/* ID */}
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {subagent.id}
        </span>

        {/* Description */}
        <span className="flex-1 truncate text-sm font-medium">
          {subagent.description}
        </span>

        {/* Status badge */}
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
            statusStyles[subagent.status]
          )}
        >
          {statusLabels[subagent.status]}
        </span>
      </button>

      {/* Expanded detail panel */}
      {open && (
        <div className="border-t border-border/50 px-4 py-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Stat label="Turns" value={subagent.turns.toString()} />
            <Stat label="Tokens" value={formatTokens(subagent.tokens)} />
            <Stat label="Duration" value={formatDuration(subagent.durationMs)} />
            {subagent.model && <Stat label="Model" value={subagent.model} />}
          </div>

          {subagent.error && (
            <div className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {subagent.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat — small key/value pair inside expanded card
// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SubagentCardList — renders cards below timeline with count badge
// ---------------------------------------------------------------------------

interface SubagentCardListProps {
  subagents: SubagentSession[];
  className?: string;
}

export function SubagentCardList({
  subagents,
  className,
}: SubagentCardListProps) {
  const [expanded, setExpanded] = React.useState(false);

  if (subagents.length === 0) {
    return null;
  }

  return (
    <section className={cn("space-y-3", className)}>
      {/* Section header with count badge */}
      <button
        type="button"
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <svg
          className={cn(
            "h-4 w-4 transition-transform",
            expanded && "rotate-90"
          )}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" />
        </svg>
        Subagents
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-semibold text-muted-foreground">
          {subagents.length}
        </span>
      </button>

      {/* Card list */}
      {expanded && (
        <div className="space-y-2">
          {subagents.map((subagent) => (
            <SubagentCard key={subagent.id} subagent={subagent} />
          ))}
        </div>
      )}
    </section>
  );
}