# Web Cleanup — Routes + Tailwind Migration

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Simplify route structure and migrate all custom CSS classes to Tailwind utility classes.

**Architecture:** Remove the redundant `_sessions` layout route (app shell is already in `__root.tsx`). Replace all custom CSS classes (`app-shell`, `sidebar-*`, `conv-*`) with Tailwind utilities. Delete `conversation-group.css`.

**Tech Stack:** TanStack Router (file-based), Tailwind CSS v4

---

## Context

### Route structure

The generated route tree (`routeTree.gen.ts`) produces:
- `/` → session list (landing)
- `/$sessionId` → session detail

The `_sessions` layout route is **redundant** — it just renders `<Outlet />` inside `AppShell`, but `AppShell` is already in `__root.tsx`. Removing it simplifies the route tree and file structure.

Current files:
```
src/routes/__root.tsx              → AppShell + Outlet (KEEP)
src/routes/_sessions.tsx           → Outlet only (DELETE)
src/routes/_sessions.index.tsx     → Session list (MOVE to index.tsx)
src/routes/_sessions.$sessionId.tsx → Session detail (MOVE to $sessionId.tsx)
```

After:
```
src/routes/__root.tsx     → AppShell + Outlet
src/routes/index.tsx      → Session list
src/routes/$sessionId.tsx → Session detail
```

### CSS classes to migrate

**app-shell.tsx** (3 classes):
- `app-shell` → flex min-h-screen layout
- `app-main` → flex-1 overflow-auto

**sidebar.tsx** (5 classes):
- `sidebar` → fixed-width sidebar panel
- `sidebar-header` → padding + border
- `sidebar-title` → heading styles
- `sidebar-nav` → flex column gap
- `sidebar-link` → link styles + active state

**conversation-group.tsx** (25+ classes, all from conversation-group.css):
- `conv-group` through `conv-token-breakdown` → all Tailwind

---

## Task 1: Simplify Route Structure

**Objective:** Remove `_sessions` layout route, move routes to root level.

**Files:**
- Delete: `web/src/routes/_sessions.tsx`
- Rename: `web/src/routes/_sessions.index.tsx` → `web/src/routes/index.tsx`
- Rename: `web/src/routes/_sessions.$sessionId.tsx` → `web/src/routes/$sessionId.tsx`

**Steps:**
1. Delete `_sessions.tsx`
2. Move `_sessions.index.tsx` content to `index.tsx` (update route path to `"/"`)
3. Move `_sessions.$sessionId.tsx` content to `$sessionId.tsx` (update route path to `"/$sessionId"`)
4. Run `npx @tanstack/router-cli generate` to regenerate route tree
5. Run `npx tsc -b` to verify
6. Run `npx vite build` to verify
7. Commit: `refactor(web): simplify route structure, remove redundant _sessions layout`

---

## Task 2: Migrate app-shell.tsx + sidebar.tsx to Tailwind

**Objective:** Replace custom CSS classes with Tailwind utilities in layout components.

**Files:**
- Modify: `web/src/components/layout/app-shell.tsx`
- Modify: `web/src/components/layout/sidebar.tsx`

**Steps:**

### app-shell.tsx

Replace:
```tsx
<div className="app-shell">
  <Sidebar />
  <main className="app-main">{children}</main>
</div>
```

With:
```tsx
<div className="flex min-h-screen">
  <Sidebar />
  <main className="flex-1 overflow-auto">{children}</main>
</div>
```

### sidebar.tsx

Replace all custom classes with Tailwind. The sidebar should be a fixed-width dark panel with nav links:

```tsx
import { Link } from "@tanstack/react-router"

export function Sidebar() {
  return (
    <aside className="flex w-60 flex-col border-r border-border bg-surface-1">
      <div className="border-b border-border px-4 py-4">
        <h2 className="text-sm font-semibold tracking-tight text-text-primary">
          Timeline
        </h2>
      </div>
      <nav className="flex flex-col gap-1 p-2">
        <Link
          to="/"
          className="rounded-md px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          activeProps={{
            className: "bg-surface-3 text-text-primary",
          }}
        >
          Sessions
        </Link>
      </nav>
    </aside>
  )
}
```

**Steps:**
1. Rewrite app-shell.tsx with Tailwind classes
2. Rewrite sidebar.tsx with Tailwind classes
3. Run `npx tsc -b` to verify
4. Commit: `refactor(web): migrate app-shell and sidebar to Tailwind`

---

## Task 3: Migrate conversation-group.tsx to Tailwind

**Objective:** Replace all `conv-*` CSS classes with Tailwind utilities. Delete `conversation-group.css`.

**Files:**
- Modify: `web/src/components/session/conversation-group.tsx`
- Delete: `web/src/components/session/conversation-group.css`

**Steps:**

Rewrite conversation-group.tsx replacing every `conv-*` class with Tailwind. Mapping:

| Old class | Tailwind replacement |
|-----------|---------------------|
| `conv-group` | `rounded-lg border border-border/30 bg-surface-1/50 mb-2 overflow-hidden transition-colors hover:border-border/50` |
| `conv-group expanded` | `+ border-accent-purple/30` |
| `conv-group-header` | `flex items-center gap-2 w-full px-3.5 py-2.5 bg-transparent border-none text-text-primary cursor-pointer text-sm text-left hover:bg-surface-2/50` |
| `conv-group-chevron` | `shrink-0 w-3.5 text-[10px] text-text-muted` |
| `conv-group-user-msg` | `flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-text-secondary` |
| `conv-group-meta` | `flex gap-1.5 shrink-0` |
| `conv-group-badge` | `inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-surface-3 text-text-muted` |
| `conv-group-badge tool` | `bg-accent-purple/15 text-accent-purple` |
| `conv-group-summary` | `flex gap-4 px-3.5 pb-2 pl-14 text-xs text-text-muted` |
| `conv-group-tokens` | `font-mono` |
| `conv-group-cost` | `font-mono text-accent-green` |
| `conv-group-body` | `px-3.5 pb-3.5 border-t border-border/30` |
| `conv-msg` | `mt-2.5 px-3 py-2.5 rounded-md text-[13px] leading-relaxed` |
| `conv-msg user` | `bg-accent-purple/8 border-l-[3px] border-accent-purple/40` |
| `conv-msg assistant` | `bg-surface-2/30 border-l-[3px] border-border/50` |
| `conv-msg-role` | `text-[11px] uppercase tracking-wider text-text-muted mb-1` |
| `conv-msg-content` | `text-text-secondary whitespace-pre-wrap break-words` |
| `conv-msg-tools` | `mt-2 flex flex-col gap-1` |
| `conv-tool-call` | `flex items-center gap-2 text-xs` |
| `conv-tool-name` | `px-1.5 py-0.5 rounded bg-accent-purple/12 text-accent-purple font-mono text-[11px]` |
| `conv-tool-args` | `text-[11px] text-text-muted bg-surface-2/50 px-1.5 py-0.5 rounded` |
| `conv-tools-section` | `mt-3` |
| `conv-section-title` | `text-xs uppercase tracking-wider text-text-muted mb-2` |
| `conv-tool-item` | `px-2.5 py-2 border border-border/30 rounded-md mb-1.5` |
| `conv-tool-item-name` | `font-mono text-xs text-accent-purple` |
| `conv-tool-result` | `mt-1.5 text-[11px] text-text-muted bg-black/20 p-2 rounded overflow-x-auto max-h-[120px]` |
| `conv-token-breakdown` | `flex gap-4 mt-3 pt-2 border-t border-border/30 text-[11px] font-mono text-text-muted` |

Then:
1. Delete `conversation-group.css`
2. Remove the `import "./conversation-group.css"` line
3. Run `npx tsc -b` to verify
4. Run `npx vite build` to verify
5. Commit: `refactor(web): migrate conversation-group to Tailwind, delete CSS`

---

## Task 4: Verify Full Build

**Objective:** Final verification that everything compiles and builds clean.

**Steps:**
1. Run `npx @tanstack/router-cli generate` — verify route tree updated
2. Run `npx tsc -b` — zero errors
3. Run `npx vite build` — successful build
4. Run `grep -rn 'conv-\\|app-shell\\|app-main\\|sidebar-' src/ --include='*.tsx'` — zero matches
5. Run `find src -name '*.css' -not -name 'app.css'` — zero results
6. Commit if any remaining fixes needed
