import { createFileRoute } from "@tanstack/react-router"
import { CostSettings } from "@/components/settings/cost-settings"

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-lg font-bold text-foreground">Settings</h1>
      <CostSettings />
    </div>
  )
}
