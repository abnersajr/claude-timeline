import { Link, useMatch } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Moon, Sun, Monitor } from "lucide-react"
import { refreshSession } from "@/lib/api"
import { useTheme } from "@/lib/theme-provider"
import { Button } from "@/components/ui/button"

export function Sidebar() {
  // @ts-expect-error TanStack Router union type doesn't narrow params correctly
  const sessionMatch = useMatch({ from: "/$sessionId", strict: false, shouldThrow: false })
  // biome-ignore lint/suspicious/noExplicitAny: TanStack Router union type doesn't narrow params
  const sessionId = (sessionMatch?.params as any)?.sessionId as string | undefined
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const themeCtx = useTheme()
  const theme = themeCtx.theme
  const setTheme = themeCtx.setTheme

  function cycleTheme() {
    const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark"
    setTheme(next)
  }

  function ThemeIcon() {
    if (theme === "dark") return <Moon className="h-3.5 w-3.5" />
    if (theme === "light") return <Sun className="h-3.5 w-3.5" />
    return <Monitor className="h-3.5 w-3.5" />
  }

  async function handleRefresh() {
    if (!sessionId || refreshing) return
    setRefreshing(true)
    try {
      const freshData = await refreshSession(sessionId)
      queryClient.setQueryData(["session", sessionId], freshData)
    } catch (err) {
      console.error("Refresh failed:", err)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <aside className="flex h-14 shrink-0 items-center border-b border-border bg-card px-6">
      <h1 className="mr-6 text-sm font-semibold tracking-tight text-foreground">
        Timeline
      </h1>
      <nav className="flex items-center gap-1">
        <Link
          to="/"
          className="rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
        >
          Sessions
        </Link>
        <Link
          to="/settings"
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground [&.active]:bg-primary/10 [&.active]:text-primary"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          Settings
        </Link>
      </nav>

      <button
        onClick={cycleTheme}
        title={`Theme: ${theme}`}
        className="ml-1 rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
      >
        <ThemeIcon />
      </button>

      {sessionId && (
        <div className="ml-auto">
          <Button
            variant="ghost"
            size="xs"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <svg
              className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
              />
            </svg>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      )}
    </aside>
  )
}
