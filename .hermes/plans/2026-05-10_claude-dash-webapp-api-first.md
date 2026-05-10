# Claude Dash — Timeline Webapp Implementation Plan (API-First)

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a React webapp that visualizes Claude Code session timelines served by the `@timeline/api` HTTP layer.

**Architecture:** API-first SPA. The webapp fetches session data from the already-built Express API (`GET /api/sessions`, `GET /api/sessions/:id`). Shared types live in a `@timeline/types` package consumed by both API and web. Session list is the landing page; session detail is a sub-route.

**Tech Stack:**
- Vite + React 19 + TypeScript
- TanStack Router (file-based routing)
- TanStack Query (server state — fetches, caching, refetching)
- Zustand (client state — UI preferences, collapsed panels)
- Tailwind CSS v4 + BaseUI (shadcn/ui component structure)
- Biome (linting/formatting)
- Vitest + React Testing Library (testing)

**Local Dev:**
- `claude-dash.local` → webapp (`:5173`)
- `api.claude-dash.local` → API (`:3001`)
- `VITE_API_URL` env var points webapp → API

**Extractor Output Schema (what the API returns):**
```typescript
interface FullTimelineSession {
  session: SessionMetadata
  turns: Turn[]
  pricing: SessionPricing
  contextStats?: ContextStats
  subagents?: Subagent[]
  conversationGroups?: ConversationGroup[]
}
```

---

## File Map

| File | Purpose |
|------|---------|
| `types/package.json` | @timeline/types package |
| `types/src/index.ts` | All shared types (re-exported from extractor) |
| `web/package.json` | Dependencies |
| `web/vite.config.ts` | Vite config |
| `web/tsconfig.json` | TypeScript config (references) |
| `web/tsconfig.app.json` | TypeScript app config |
| `web/tsconfig.node.json` | TypeScript node config |
| `web/biome.json` | Biome config |
| `web/index.html` | Entry HTML |
| `web/src/main.tsx` | React entry point |
| `web/src/app.css` | Tailwind imports + custom theme |
| `web/src/routeTree.gen.ts` | TanStack Router generated tree |
| `web/src/routes/__root.tsx` | Root layout |
| `web/src/routes/_sessions.tsx` | Sessions layout (sidebar + content) |
| `web/src/routes/_sessions.index.tsx` | Session list (landing page) |
| `web/src/routes/_sessions.$sessionId.tsx` | Session detail page |
| `web/src/lib/api.ts` | API client (fetch wrappers) |
| `web/src/lib/grouping.ts` | Conversation grouping logic |
| `web/src/stores/ui-store.ts` | Zustand store (UI prefs) |
| `web/src/components/layout/app-shell.tsx` | Main layout |
| `web/src/components/layout/sidebar.tsx` | Left sidebar navigation |
| `web/src/components/session/session-list.tsx` | Session list table |
| `web/src/components/session/session-list-row.tsx` | Single session row |
| `web/src/components/session/overview-card.tsx` | Session summary card |
| `web/src/components/session/timeline.tsx` | Timeline container |
| `web/src/components/session/turn-card.tsx` | Individual turn display |
| `web/src/components/session/conversation-group.tsx` | Grouped conversation block |
| `web/src/components/session/tool-call.tsx` | Tool call with expand/collapse |
| `web/src/components/session/token-badge.tsx` | Token count badge |
| `web/src/components/session/token-chart.tsx` | Token usage chart |
| `web/src/components/session/cost-breakdown.tsx` | Cost breakdown panel |
| `web/src/components/session/subagent-card.tsx` | Subagent session card |
| `web/src/components/session/context-stats.tsx` | Context window visualization |
| `web/src/components/ui/card.tsx` | BaseUI Card wrapper |
| `web/src/components/ui/badge.tsx` | BaseUI Badge wrapper |
| `web/src/components/ui/button.tsx` | BaseUI Button wrapper |
| `web/src/components/ui/collapsible.tsx` | BaseUI Collapsible wrapper |
| `web/src/components/ui/scroll-area.tsx` | BaseUI ScrollArea wrapper |
| `web/src/components/ui/sheet.tsx` | BaseUI Sheet wrapper (sidebar) |
| `web/src/components/ui/tabs.tsx` | BaseUI Tabs wrapper |
| `web/src/components/ui/skeleton.tsx` | Loading skeleton |
| `web/src/lib/utils.ts` | cn() helper, formatters |

---

## Task 1: Create @timeline/types Package

**Objective:** Extract shared TypeScript types into a dedicated package so API and webapp share a single source of truth.

**Files:**
- Create: `types/package.json`
- Create: `types/src/index.ts`
- Create: `types/tsconfig.json`

**Step 1: Create `types/package.json`**

```json
{
  "name": "@timeline/types",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

**Step 2: Create `types/src/index.ts`**

Re-export everything from the extractor's types as the canonical source:

```typescript
export type {
  TokenUsage,
  TurnPricing,
  SessionPricing,
  PricingRate,
  SessionMetadata,
  Turn,
  Message,
  MessageContent,
  TextContent,
  ToolUseContent,
  ToolResultContent,
  ToolCall,
  ToolExecution,
  Subagent,
  SubagentFile,
  ConversationGroup,
  FullTimelineSession,
  ContextStats,
  ContextCategory,
  ContextInjection,
  TurnContextSnapshot,
  Phase,
  ClassifiedMessage,
  MessageCategory,
  RawJsonlRecord,
} from "@timeline/extractor/types"
```

**Step 3: Create `types/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "declaration": true
  },
  "include": ["src"]
}
```

**Step 4: Add to root workspaces**

In root `package.json`, add `"types"` to workspaces:

```json
"workspaces": ["extractor", "api", "types"]
```

**Step 5: Install and verify**

```bash
cd /Users/abnersoaresalvesjunior/projects/claude-dash/timeline
pnpm install
cd types && pnpm exec tsc --noEmit
```

Expected: No errors.

**Step 6: Update API to use @timeline/types**

In `api/package.json`, add dependency:
```json
"@timeline/types": "workspace:*"
```

In API route handlers, import types from `@timeline/types` instead of `@timeline/extractor/types`. Verify with `pnpm --filter @timeline/api typecheck`.

**Step 7: Commit**

```bash
git add types/ package.json api/package.json api/src/
git commit -m "feat(types): extract shared types to @timeline/types package"
```

---

## Task 2: Scaffold Vite + React + TypeScript Project

**Objective:** Create the `web/` directory with Vite, React, TypeScript, and Biome configured.

**Files:**
- Create: `web/package.json`
- Create: `web/vite.config.ts`
- Create: `web/tsconfig.json`
- Create: `web/tsconfig.app.json`
- Create: `web/tsconfig.node.json`
- Create: `web/biome.json`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`

**Step 1: Initialize the project**

```bash
cd /Users/abnersoaresalvesjunior/projects/claude-dash/timeline
mkdir -p web/src
cd web
pnpm init
```

**Step 2: Create `web/package.json`**

```json
{
  "name": "@timeline/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "biome check .",
    "format": "biome format .",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.14",
    "@types/react": "^19.1.2",
    "@types/react-dom": "^19.1.2",
    "@vitejs/plugin-react": "^4.5.2",
    "typescript": "^5.8.3",
    "vite": "^6.3.4",
    "vitest": "^3.1.1"
  }
}
```

**Step 3: Install dependencies**

```bash
cd web
pnpm add react react-dom
pnpm add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom @biomejs/biome vitest
```

**Step 4: Create `web/vite.config.ts`**

```typescript
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
})
```

**Step 5: Create `web/tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

**Step 6: Create `web/tsconfig.app.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

**Step 7: Create `web/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["vite.config.ts"]
}
```

**Step 8: Create `web/biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "files": {
    "ignore": ["node_modules", "dist"]
  },
  "linter": {
    "rules": {
      "recommended": true
    }
  },
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2
  }
}
```

**Step 9: Create `web/index.html`**

```html
<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claude Dash — Timeline</title>
  </head>
  <body class="bg-zinc-950 text-zinc-100 antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 10: Create `web/src/main.tsx`**

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

**Step 11: Create `web/src/App.tsx`**

```tsx
export function App() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <h1 className="p-8 text-2xl font-bold">Claude Dash</h1>
    </div>
  )
}
```

**Step 12: Run dev server to verify**

```bash
cd web
pnpm dev
```

Expected: App renders at http://localhost:5173 with "Claude Dash" heading.

**Step 13: Add web/ to workspace**

In root `package.json`, add `"web"` to workspaces:

```json
"workspaces": ["extractor", "api", "types", "web"]
```

**Step 14: Commit**

```bash
git add web/ package.json
git commit -m "feat(web): scaffold Vite + React + TypeScript project"
```

---

## Task 3: Install and Configure Tailwind CSS

**Objective:** Add Tailwind CSS v4 with a custom dark theme color palette.

**Files:**
- Create: `web/src/app.css`
- Modify: `web/vite.config.ts`
- Modify: `web/src/main.tsx`
- Modify: `web/index.html`

**Step 1: Install Tailwind**

```bash
cd web
pnpm add -D tailwindcss @tailwindcss/vite
```

**Step 2: Update `web/vite.config.ts`**

```typescript
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
})
```

**Step 3: Create `web/src/app.css`**

```css
@import "tailwindcss";

@theme {
  /* Brand colors */
  --color-brand-50: oklch(0.97 0.02 250);
  --color-brand-100: oklch(0.93 0.04 250);
  --color-brand-200: oklch(0.87 0.07 250);
  --color-brand-300: oklch(0.78 0.1 250);
  --color-brand-400: oklch(0.68 0.14 250);
  --color-brand-500: oklch(0.58 0.16 250);
  --color-brand-600: oklch(0.48 0.16 250);
  --color-brand-700: oklch(0.40 0.14 250);
  --color-brand-800: oklch(0.33 0.11 250);
  --color-brand-900: oklch(0.27 0.08 250);
  --color-brand-950: oklch(0.21 0.05 250);

  /* Surface colors (dark theme) */
  --color-surface-0: oklch(0.13 0.005 250);
  --color-surface-1: oklch(0.16 0.005 250);
  --color-surface-2: oklch(0.19 0.005 250);
  --color-surface-3: oklch(0.22 0.005 250);
  --color-surface-4: oklch(0.25 0.005 250);

  /* Accent colors */
  --color-accent-green: oklch(0.72 0.17 155);
  --color-accent-orange: oklch(0.75 0.15 60);
  --color-accent-red: oklch(0.65 0.2 25);
  --color-accent-blue: oklch(0.65 0.15 250);
  --color-accent-purple: oklch(0.65 0.15 300);

  /* Semantic colors */
  --color-text-primary: oklch(0.93 0.01 250);
  --color-text-secondary: oklch(0.65 0.01 250);
  --color-text-muted: oklch(0.50 0.01 250);
  --color-border: oklch(0.25 0.005 250);
  --color-border-subtle: oklch(0.20 0.005 250);
}
```

**Step 4: Update `web/src/main.tsx`**

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./app.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

**Step 5: Verify Tailwind works**

Update `web/src/App.tsx` to use a Tailwind class:

```tsx
export function App() {
  return (
    <div className="min-h-screen bg-surface-0 text-text-primary">
      <h1 className="p-8 text-2xl font-bold">Claude Dash</h1>
    </div>
  )
}
```

Run `pnpm dev` — verify dark background renders.

**Step 6: Commit**

```bash
git add web/
git commit -m "feat(web): add Tailwind CSS with custom dark theme"
```

---

## Task 4: Install BaseUI and Create UI Primitives

**Objective:** Install BaseUI and create thin wrapper components following shadcn/ui patterns.

**Files:**
- Create: `web/src/lib/utils.ts`
- Create: `web/src/components/ui/card.tsx`
- Create: `web/src/components/ui/badge.tsx`
- Create: `web/src/components/ui/button.tsx`
- Create: `web/src/components/ui/collapsible.tsx`
- Create: `web/src/components/ui/tabs.tsx`
- Create: `web/src/components/ui/sheet.tsx`
- Create: `web/src/components/ui/skeleton.tsx`
- Create: `web/src/components/ui/scroll-area.tsx`

**Step 1: Install dependencies**

```bash
cd web
pnpm add @base-ui-components/react clsx tailwind-merge
```

**Step 2: Create `web/src/lib/utils.ts`**

```typescript
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
  return `$${n.toFixed(4)}`
}

export function formatDuration(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${ms}ms`
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
```

**Step 3: Create UI components**

Create each component as a thin wrapper around BaseUI with Tailwind styling. Components: `card.tsx`, `badge.tsx`, `button.tsx`, `collapsible.tsx`, `tabs.tsx`, `sheet.tsx`, `skeleton.tsx`, `scroll-area.tsx`. Each follows the shadcn/ui pattern: `forwardRef` wrapper, `cn()` for class merging, consistent dark-theme styling.

**Step 4: Commit**

```bash
git add web/src/lib/ web/src/components/ui/
git commit -m "feat(web): add BaseUI primitives and utility functions"
```

---

## Task 5: API Client + TanStack Query Setup

**Objective:** Create the API client layer and configure TanStack Query for data fetching.

**Files:**
- Create: `web/src/lib/api.ts`
- Create: `web/src/lib/query-client.ts`
- Modify: `web/src/main.tsx`
- Modify: `web/package.json`

**Step 1: Install TanStack Query**

```bash
cd web
pnpm add @tanstack/react-query
```

**Step 2: Create `web/src/lib/api.ts`**

```typescript
import type { FullTimelineSession, SessionMetadata } from "@timeline/types"

const API_BASE = import.meta.env.VITE_API_URL ?? "https://api.claude-dash.local"

interface SessionListResponse {
  sessions: SessionMetadata[]
  total: number
}

interface HealthResponse {
  status: "ok" | "degraded" | "down"
  version: string
  uptime: number
  timestamp: string
}

export async function fetchSessions(
  limit = 50,
  offset = 0,
): Promise<SessionListResponse> {
  const res = await fetch(
    `${API_BASE}/api/sessions?limit=${limit}&offset=${offset}`,
  )
  if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`)
  return res.json()
}

export async function fetchSession(
  id: string,
): Promise<FullTimelineSession> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`)
  if (!res.ok) throw new Error(`Failed to fetch session: ${res.status}`)
  return res.json()
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/api/health`)
  if (!res.ok) throw new Error(`Failed to fetch health: ${res.status}`)
  return res.json()
}
```

**Step 3: Create `web/src/lib/query-client.ts`**

```typescript
import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})
```

**Step 4: Update `web/src/main.tsx`**

```tsx
import { QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { queryClient } from "./lib/query-client"
import "./app.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
```

**Step 5: Commit**

```bash
git add web/src/lib/ web/src/main.tsx web/package.json
git commit -m "feat(web): add API client and TanStack Query setup"
```

---

## Task 6: TanStack Router Setup + Root Layout

**Objective:** Configure TanStack Router with file-based routing and create the root layout with sidebar.

**Files:**
- Create: `web/src/routes/__root.tsx`
- Create: `web/src/components/layout/app-shell.tsx`
- Create: `web/src/components/layout/sidebar.tsx`
- Modify: `web/src/main.tsx`
- Modify: `web/package.json`

**Step 1: Install TanStack Router**

```bash
cd web
pnpm add @tanstack/react-router @tanstack/router-devtools
pnpm add -D @tanstack/router-plugin
```

**Step 2: Update Vite config for router plugin**

```typescript
import { TanStackRouterVite } from "@tanstack/router-plugin/vite"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [TanStackRouterVite(), tailwindcss(), react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
})
```

**Step 3: Create `web/src/routes/__root.tsx`**

Root layout with Outlet for nested routes:

```tsx
import { Outlet, createRootRoute } from "@tanstack/react-router"

export const Route = createRootRoute({
  component: () => <Outlet />,
})
```

**Step 4: Create app shell and sidebar**

The sidebar shows: session list link, project name, model info. The app shell wraps sidebar + main content area.

**Step 5: Update `web/src/main.tsx`**

Wire up TanStack Router with the generated route tree.

**Step 6: Verify routing works**

Run `pnpm dev` — verify the root layout renders and router devtools appear.

**Step 7: Commit**

```bash
git add web/src/routes/ web/src/components/layout/ web/src/main.tsx web/vite.config.ts web/package.json
git commit -m "feat(web): add TanStack Router with root layout and sidebar"
```

---

## Task 7: Session List Page (Landing)

**Objective:** Build the session list page that fetches from `GET /api/sessions` and displays a table of sessions.

**Files:**
- Create: `web/src/routes/_sessions.tsx`
- Create: `web/src/routes/_sessions.index.tsx`
- Create: `web/src/components/session/session-list.tsx`
- Create: `web/src/components/session/session-list-row.tsx`

**Step 1: Create sessions layout route**

`_sessions.tsx` — wraps session list and detail in the app shell with sidebar.

**Step 2: Create session list component**

Uses `useQuery` to fetch sessions. Shows a table with columns:
- Project name
- Model
- Turn count
- Total tokens
- Total cost
- Start time
- Duration
- Status (ongoing/completed)

**Step 3: Create session list row**

Each row links to `/sessions/$sessionId`. Shows formatted values.

**Step 4: Create the index route**

`_sessions.index.tsx` — renders `<SessionList />` as the landing page.

**Step 5: Verify**

Run `pnpm dev` — verify session list loads from API and renders in the table.

**Step 6: Commit**

```bash
git add web/src/routes/_sessions* web/src/components/session/session-list*
git commit -m "feat(web): add session list page as landing"
```

---

## Task 8: Session Detail Page Shell

**Objective:** Create the session detail page that fetches full timeline data and renders the overview card + timeline.

**Files:**
- Create: `web/src/routes/_sessions.$sessionId.tsx`
- Create: `web/src/components/session/overview-card.tsx`
- Create: `web/src/components/session/timeline.tsx`
- Create: `web/src/components/session/skeleton.tsx`

**Step 1: Create session detail route**

Uses `useQuery` to fetch `GET /api/sessions/:id`. Shows loading skeleton while fetching.

**Step 2: Create overview card**

Displays session metadata: project, model, working directory, turn count, total tokens, cost, duration, start/end time.

**Step 3: Create timeline container**

Renders the list of turns. Each turn is a `<TurnCard />` (next task).

**Step 4: Create loading skeletons**

Skeleton components for session list and detail views.

**Step 5: Verify**

Run `pnpm dev` — click a session from the list, verify detail page loads and shows overview + timeline.

**Step 6: Commit**

```bash
git add web/src/routes/_sessions.\$sessionId.tsx web/src/components/session/overview-card.tsx web/src/components/session/timeline.tsx web/src/components/session/skeleton.tsx
git commit -m "feat(web): add session detail page with overview and timeline"
```

---

## Task 9: Turn Card + Tool Calls

**Objective:** Build the turn card component that displays individual conversation turns with expandable tool calls.

**Files:**
- Create: `web/src/components/session/turn-card.tsx`
- Create: `web/src/components/session/tool-call.tsx`
- Create: `web/src/components/session/token-badge.tsx`

**Step 1: Create token badge**

Small badge showing token count (input/output/cache) with color coding.

**Step 2: Create tool call component**

Expandable tool call display: tool name, input summary, result preview. Uses BaseUI Collapsible.

**Step 3: Create turn card**

Shows: timestamp, model, token usage badges, messages (text content), tool calls list. Expandable for details.

**Step 4: Wire into timeline**

Update `timeline.tsx` to render `<TurnCard />` for each turn.

**Step 5: Commit**

```bash
git add web/src/components/session/turn-card.tsx web/src/components/session/tool-call.tsx web/src/components/session/token-badge.tsx web/src/components/session/timeline.tsx
git commit -m "feat(web): add turn card with tool calls and token badges"
```

---

## Task 10: Token Chart + Cost Breakdown

**Objective:** Build token usage chart and cost breakdown panels for the session detail view.

**Files:**
- Create: `web/src/components/session/token-chart.tsx`
- Create: `web/src/components/session/cost-breakdown.tsx`

**Step 1: Create token chart**

Bar chart showing token usage per turn (input, output, cache read, cache creation). Uses CSS-based bars (no chart library — YAGNI).

**Step 2: Create cost breakdown**

Panel showing: total cost, per-turn cost breakdown, pricing rate used. Uses the `pricing` field from `FullTimelineSession`.

**Step 3: Wire into session detail**

Add both panels to the session detail page, below the overview card.

**Step 4: Commit**

```bash
git add web/src/components/session/token-chart.tsx web/src/components/session/cost-breakdown.tsx web/src/routes/_sessions.\$sessionId.tsx
git commit -m "feat(web): add token chart and cost breakdown panels"
```

---

## Task 11: Subagent Cards

**Objective:** Display subagent sessions spawned during the main session.

**Files:**
- Create: `web/src/components/session/subagent-card.tsx`

**Step 1: Create subagent card**

Shows: subagent ID, description, status (completed/failed/pending), turn count, token usage, duration. Collapsed by default. Expandable to show messages and tool calls.

**Step 2: Wire into session detail**

Render subagent cards below the timeline, collapsed by default with a count badge.

**Step 3: Commit**

```bash
git add web/src/components/session/subagent-card.tsx web/src/routes/_sessions.\$sessionId.tsx
git commit -m "feat(web): add subagent cards to session detail"
```

---

## Task 12: Conversation Groups

**Objective:** Display grouped conversations (user message + AI responses) as an alternative timeline view.

**Files:**
- Create: `web/src/components/session/conversation-group.tsx`
- Create: `web/src/lib/grouping.ts`

**Step 1: Create grouping utility**

Helper to transform `conversationGroups` from the API into display-ready data. If API doesn't return `conversationGroups`, fall back to client-side grouping from turns.

**Step 2: Create conversation group component**

Collapsible block showing: user message, AI responses, tool executions, token usage, cost, duration. Collapsed by default.

**Step 3: Add toggle to session detail**

Tabs to switch between "Turns" view and "Conversations" view.

**Step 4: Commit**

```bash
git add web/src/components/session/conversation-group.tsx web/src/lib/grouping.ts web/src/routes/_sessions.\$sessionId.tsx
git commit -m "feat(web): add conversation groups view"
```

---

## Task 13: Context Stats Visualization

**Objective:** Display context window usage statistics when available.

**Files:**
- Create: `web/src/components/session/context-stats.tsx`

**Step 1: Create context stats component**

Visualizes `ContextStats` from the API: tokens by category (user-message, tool-output, thinking-text, system, compact, other), phase count, injection timeline. Collapsed by default.

**Step 2: Wire into session detail**

Show context stats panel when `contextStats` is present in the response.

**Step 3: Commit**

```bash
git add web/src/components/session/context-stats.tsx web/src/routes/_sessions.\$sessionId.tsx
git commit -m "feat(web): add context stats visualization"
```

---

## Task 14: Zustand UI Store

**Objective:** Add client-side state for UI preferences (collapsed panels, view mode).

**Files:**
- Create: `web/src/stores/ui-store.ts`

**Step 1: Create UI store**

```typescript
import { create } from "zustand"

interface UiState {
  sidebarOpen: boolean
  viewMode: "turns" | "conversations"
  toggleSidebar: () => void
  setViewMode: (mode: "turns" | "conversations") => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  viewMode: "turns",
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setViewMode: (mode) => set({ viewMode: mode }),
}))
```

**Step 2: Wire into components**

Use `useUiStore` in sidebar (toggle), session detail (view mode tabs).

**Step 3: Commit**

```bash
git add web/src/stores/ui-store.ts
git commit -m "feat(web): add Zustand UI store for preferences"
```

---

## Task 15: Polish + localias Config

**Objective:** Final polish, loading states, error states, and localias HTTPS config.

**Files:**
- Modify: `web/vite.config.ts` (HTTPS)
- Create: `scripts/localias-setup.sh` (if not exists)

**Step 1: Add error boundaries**

Wrap routes in error boundaries with retry buttons.

**Step 2: Add empty states**

Show helpful messages when no sessions exist or API is unreachable.

**Step 3: Configure localias**

Add `claude-dash.local` → `:5173` to localias config for HTTPS dev.

**Step 4: Final verification**

Run full flow: open `https://claude-dash.local`, see session list, click session, see full timeline with all panels.

**Step 5: Commit**

```bash
git add web/
git commit -m "feat(web): polish loading/error states and localias config"
```
