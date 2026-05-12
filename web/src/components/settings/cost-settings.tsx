import { useEffect, useState } from "react"
import { fetchStatus, updateCostMethod, type CostStatus } from "@/lib/api"
import { cn } from "@/lib/utils"

type CostMethod = "api" | "estimated" | "auto"

const COST_METHODS: { value: CostMethod; label: string; description: string }[] = [
  {
    value: "auto",
    label: "Auto",
    description: "Use API cost when available, fall back to estimated",
  },
  {
    value: "api",
    label: "API Only",
    description: "Always use cost-capture data (falls back to estimated if unavailable)",
  },
  {
    value: "estimated",
    label: "Estimated",
    description: "Always use JSONL token counts × pricing rates",
  },
]

export function CostSettings() {
  const [status, setStatus] = useState<CostStatus | null>(null)
  const [selected, setSelected] = useState<CostMethod>("auto")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchStatus()
      .then((s) => {
        setStatus(s)
        setSelected(s.costMethod)
      })
      .catch(console.error)
  }, [])

  const handleSave = async (method: CostMethod) => {
    setSaving(true)
    try {
      await updateCostMethod(method)
      setSelected(method)
    } catch (err) {
      console.error("Failed to update:", err)
    } finally {
      setSaving(false)
    }
  }

  if (!status) {
    return <div className="text-sm text-muted-foreground">Loading...</div>
  }

  return (
    <div className="space-y-6">
      {/* Cost Capture Status */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Cost Capture
        </h2>
        <div
          className={cn(
            "flex items-center gap-2 text-sm",
            status.costCapture.installed
              ? "text-emerald-400"
              : "text-muted-foreground"
          )}
        >
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              status.costCapture.installed
                ? "bg-emerald-500"
                : "bg-muted-foreground/40"
            )}
          />
          {status.costCapture.installed ? "Active" : "Not installed"}
        </div>
        {status.costCapture.installed && (
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <p>DB: {status.costCapture.dbPath}</p>
            <p>{status.costCapture.sessionCount} sessions with cost data</p>
          </div>
        )}
        {!status.costCapture.installed && (
          <p className="mt-2 text-xs text-muted-foreground">
            Run <code className="rounded bg-accent px-1">claude-dash setup</code> to enable
          </p>
        )}
      </section>

      {/* Cost Calculation Method */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Cost Calculation Method
        </h2>
        <div className="space-y-2">
          {COST_METHODS.map((method) => (
            <label
              key={method.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                selected === method.value
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:bg-muted/30"
              )}
            >
              <input
                type="radio"
                name="costMethod"
                value={method.value}
                checked={selected === method.value}
                onChange={() => handleSave(method.value)}
                disabled={saving}
                className="mt-0.5"
              />
              <div>
                <span className="text-sm font-medium text-foreground">
                  {method.label}
                </span>
                <p className="text-xs text-muted-foreground">
                  {method.description}
                </p>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* Summary */}
      {status.costCapture.installed && (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Summary
          </h2>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>Sessions with API cost: checking...</p>
            <p>Sessions with estimated only: checking...</p>
          </div>
        </section>
      )}
    </div>
  )
}
