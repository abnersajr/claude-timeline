import { Link } from '@tanstack/react-router'

export function Sidebar() {
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
      </nav>
    </aside>
  )
}
