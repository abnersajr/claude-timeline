# Claude Dash — Timeline Webapp Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a React webapp that visualizes Claude Code session timelines extracted by `@timeline/extractor`, with a dark-themed UI inspired by claude-devtools.

**Architecture:** Vite + React SPA with TanStack Router for routing, Zustand for state management, Tailwind CSS + BaseUI (shadcn/ui structure) for components. User drags a JSON file onto the page, the app parses it, groups conversations client-side, and renders a session detail view with overview, timeline, token usage, and cost breakdown.

**Tech Stack:**
- Vite + React 19 + TypeScript
- TanStack Router (file-based routing)
- Zustand (state management)
- Tailwind CSS v4 + BaseUI (shadcn/ui component structure)
- Biome (linting/formatting)
- Vitest + React Testing Library (testing)

**Extractor Output Schema** (input to the UI):
```typescript
interface FullTimelineSession {
  session: SessionMetadata
  turns: Turn[]
  pricing: SessionPricing
}
```

---

## File Map

| File | Purpose |
|------|---------|
| `web/package.json` | Dependencies |
| `web/vite.config.ts` | Vite config |
| `web/tailwind.config.ts` | Tailwind + custom dark theme |
| `web/tsconfig.json` | TypeScript config |
| `web/biome.json` | Biome config |
| `web/index.html` | Entry HTML |
| `web/src/main.tsx` | React entry point |
| `web/src/routeTree.gen.ts` | TanStack Router generated tree |
| `web/src/routes/__root.tsx` | Root layout |
| `web/src/routes/index.tsx` | Landing page (drag-and-drop) |
| `web/src/routes/session.$sessionId.tsx` | Session detail page |
| `web/src/lib/types.ts` | UI data types (mirrors extractor) |
| `web/src/lib/grouping.ts` | Conversation grouping logic |
| `web/src/stores/session-store.ts` | Zustand store |
| `web/src/components/layout/app-shell.tsx` | Main layout (sidebar + content) |
| `web/src/components/layout/sidebar.tsx` | Left sidebar navigation |
| `web/src/components/drop-zone.tsx` | Drag-and-drop file upload |
| `web/src/components/session/overview-card.tsx` | Session summary card |
| `web/src/components/session/timeline.tsx` | Timeline container |
| `web/src/components/session/turn-card.tsx` | Individual turn display |
| `web/src/components/session/conversation-group.tsx` | Grouped conversation block |
| `web/src/components/session/tool-call.tsx` | Tool call with expand/collapse |
| `web/src/components/session/token-badge.tsx` | Token count badge |
| `web/src/components/session/token-chart.tsx` | Token usage chart |
| `web/src/components/session/cost-breakdown.tsx` | Cost breakdown panel |
| `web/src/components/ui/card.tsx` | BaseUI Card wrapper |
| `web/src/components/ui/badge.tsx` | BaseUI Badge wrapper |
| `web/src/components/ui/button.tsx` | BaseUI Button wrapper |
| `web/src/components/ui/collapsible.tsx` | BaseUI Collapsible wrapper |
| `web/src/components/ui/scroll-area.tsx` | BaseUI ScrollArea wrapper |
| `web/src/components/ui/sheet.tsx` | BaseUI Sheet wrapper (sidebar) |
| `web/src/components/ui/tabs.tsx` | BaseUI Tabs wrapper |
| `web/src/lib/utils.ts` | cn() helper, formatters |

---

## Task 1: Scaffold Vite + React + TypeScript Project

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

**Step 2: Install dependencies**

```bash
pnpm add react react-dom
pnpm add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom @biomejs/biome
```

**Step 3: Create `web/package.json`**

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

**Step 4: Create `web/vite.config.ts`**

```typescript
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
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

Expected: App renders at http://localhost:3000 with "Claude Dash" heading.

**Step 13: Add web/ to workspace**

In root `package.json`, add `"web"` to workspaces:

```json
"workspaces": ["extractor", "web"]
```

**Step 14: Commit**

```bash
git add web/ package.json
git commit -m "feat(web): scaffold Vite + React + TypeScript project"
```

---

## Task 2: Install and Configure Tailwind CSS

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
    port: 3000,
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

## Task 3: Install BaseUI and Create shadcn-style UI Primitives

**Objective:** Install BaseUI and create thin wrapper components following shadcn/ui patterns (copy-paste, not a library dependency).

**Files:**
- Create: `web/src/components/ui/card.tsx`
- Create: `web/src/components/ui/badge.tsx`
- Create: `web/src/components/ui/button.tsx`
- Create: `web/src/components/ui/collapsible.tsx`
- Create: `web/src/components/ui/tabs.tsx`
- Create: `web/src/components/ui/sheet.tsx`
- Create: `web/src/lib/utils.ts`

**Step 1: Install BaseUI**

```bash
cd web
pnpm add @base-ui-components/react
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
```

**Step 3: Install clsx and tailwind-merge**

```bash
pnpm add clsx tailwind-merge
```

**Step 4: Create `web/src/components/ui/card.tsx`**

```tsx
import { forwardRef, type ComponentProps } from "react"
import { cn } from "@/lib/utils"

export const Card = forwardRef<HTMLDivElement, ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border border-border bg-surface-1 p-6",
        className,
      )}
      {...props}
    />
  ),
)
Card.displayName = "Card"

export const CardHeader = forwardRef<HTMLDivElement, ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1.5", className)} {...props} />
  ),
)
CardHeader.displayName = "CardHeader"

export const CardTitle = forwardRef<HTMLDivElement, ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("font-semibold leading-none", className)} {...props} />
  ),
)
CardTitle.displayName = "CardTitle"

export const CardDescription = forwardRef<HTMLDivElement, ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-sm text-text-secondary", className)} {...props} />
  ),
)
CardDescription.displayName = "CardDescription"

export const CardContent = forwardRef<HTMLDivElement, ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("pt-0", className)} {...props} />
  ),
)
CardContent.displayName = "CardContent"
```

**Step 5: Create `web/src/components/ui/badge.tsx`**

```tsx
import { forwardRef, type ComponentProps } from "react"
import { cn } from "@/lib/utils"

type BadgeVariant = "default" | "secondary" | "success" | "warning" | "error" | "info"

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-surface-3 text-text-primary",
  secondary: "bg-surface-2 text-text-secondary",
  success: "bg-accent-green/15 text-accent-green",
  warning: "bg-accent-orange/15 text-accent-orange",
  error: "bg-accent-red/15 text-accent-red",
  info: "bg-accent-blue/15 text-accent-blue",
}

interface BadgeProps extends ComponentProps<"span"> {
  variant?: BadgeVariant
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  ),
)
Badge.displayName = "Badge"
```

**Step 6: Create `web/src/components/ui/button.tsx`**

```tsx
import { forwardRef, type ComponentProps } from "react"
import { cn } from "@/lib/utils"

type ButtonVariant = "default" | "secondary" | "ghost" | "outline"
type ButtonSize = "default" | "sm" | "lg" | "icon"

const variantStyles: Record<ButtonVariant, string> = {
  default: "bg-brand-600 text-white hover:bg-brand-500",
  secondary: "bg-surface-3 text-text-primary hover:bg-surface-4",
  ghost: "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
  outline: "border border-border text-text-secondary hover:bg-surface-2",
}

const sizeStyles: Record<ButtonSize, string> = {
  default: "h-9 px-4 py-2",
  sm: "h-8 px-3 text-sm",
  lg: "h-10 px-6",
  icon: "h-9 w-9",
}

interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
        "disabled:pointer-events-none disabled:opacity-50",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = "Button"
```

**Step 7: Create `web/src/components/ui/collapsible.tsx`**

```tsx
import { Collapsible as BaseCollapsible } from "@base-ui-components/react/collapsible"

export const Collapsible = BaseCollapsible
export const CollapsibleTrigger = BaseCollapsible.Trigger
export const CollapsibleContent = BaseCollapsible.Content
```

**Step 8: Create `web/src/components/ui/tabs.tsx`**

```tsx
import { Tabs as BaseTabs } from "@base-ui-components/react/tabs"

export const Tabs = BaseTabs
export const TabsList = BaseTabs.List
export const TabsTab = BaseTabs.Tab
export const TabsPanel = BaseTabs.Panel
```

**Step 9: Create `web/src/components/ui/sheet.tsx`**

Sheet (drawer/panel) for the sidebar — BaseUI doesn't have a Sheet, so we build a simple one:

```tsx
import { forwardRef, type ComponentProps, type ReactNode } from "react"
import { cn } from "@/lib/utils"

interface SheetProps extends ComponentProps<"div"> {
  open: boolean
  onClose: () => void
  side?: "left" | "right"
  children: ReactNode
}

export const Sheet = forwardRef<HTMLDivElement, SheetProps>(
  ({ open, onClose, side = "left", className, children, ...props }, ref) => {
    if (!open) return null
    return (
      <>
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={onClose}
        />
        <div
          ref={ref}
          className={cn(
            "fixed inset-y-0 z-50 flex flex-col bg-surface-1 border-r border-border",
            "transition-transform duration-200",
            side === "left" ? "left-0" : "right-0",
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </>
    )
  },
)
Sheet.displayName = "Sheet"
```

**Step 10: Commit**

```bash
git add web/
git commit -m "feat(web): add BaseUI + shadcn-style UI primitives"
```

---

## Task 4: Define UI Data Types

**Objective:** Create TypeScript types that mirror the extractor's output schema, plus UI-specific types for conversation grouping.

**Files:**
- Create: `web/src/lib/types.ts`

**Step 1: Create `web/src/lib/types.ts`**

```typescript
// ─── Extractor Output Types (mirror of @timeline/extractor types.ts) ───

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreation5mTokens: number
  cacheCreation1hTokens: number
  cacheCreationTokens?: number
}

export interface SessionMetadata {
  sessionId: string
  projectName: string
  model: string
  commandExecuted?: string
  workingDirectory: string
  turnCount: number
  totalTokens: TokenUsage
  startTime: string
  endTime: string
}

export interface Turn {
  timestamp: string
  tokenUsage: TokenUsage
  toolName?: string
  cwd?: string
  messages: Message[]
  toolCalls: ToolCall[]
  cacheWriteType: "5m" | "1h" | "none"
  cacheReadType: "5m" | "1h" | "5m-fallback" | "unknown"
  cacheCreationTokensThisTurn: number
}

export interface Message {
  type: "assistant" | "user" | "system"
  timestamp?: string
  content: MessageContent[]
}

export type MessageContent = TextContent | ToolUseContent | ToolResultContent

export interface TextContent {
  type: "text"
  text: string
}

export interface ToolUseContent {
  type: "tool_use"
  name: string
  input: Record<string, unknown>
  toolUseId: string
}

export interface ToolResultContent {
  type: "tool_result"
  toolUseId: string
  content: unknown
  isError?: boolean
}

export interface ToolCall {
  toolUseId: string
  name: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
  timestamp?: string
}

export interface PricingRate {
  model: string
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheCreation5mPerMTok: number
  cacheCreation1hPerMTok: number
}

export interface TurnPricing {
  inputCost: number
  outputCost: number
  cacheReadCost: number
  cacheCreation5mCost: number
  cacheCreation1hCost: number
  totalCost: number
}

export interface SessionPricing {
  totalCost: number
  turnsPricing: TurnPricing[]
  pricingRate: PricingRate
}

export interface FullTimelineSession {
  session: SessionMetadata
  turns: Turn[]
  pricing: SessionPricing
}

// ─── UI-Specific Types ───

export interface ConversationGroup {
  id: string
  userMessage: Turn | null
  aiResponses: Turn[]
  startTime: string
  endTime: string
  durationMs: number
}

export interface TokenDataPoint {
  turnIndex: number
  timestamp: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}
```

**Step 2: Commit**

```bash
git add web/src/lib/types.ts
git commit -m "feat(web): add UI data types mirroring extractor schema"
```

---

## Task 5: Build Conversation Grouping Logic

**Objective:** Implement client-side logic that groups turns into conversation blocks (user message → AI responses).

**Files:**
- Create: `web/src/lib/grouping.ts`
- Create: `web/src/lib/grouping.test.ts`

**Step 1: Write failing test**

```typescript
// web/src/lib/grouping.test.ts
import { describe, expect, it } from "vitest"
import type { Turn } from "./types"
import { buildConversationGroups, buildTokenChartData } from "./grouping"

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    timestamp: "2026-05-07T19:22:45.000Z",
    tokenUsage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0 },
    messages: [],
    toolCalls: [],
    cacheWriteType: "none",
    cacheReadType: "unknown",
    cacheCreationTokensThisTurn: 0,
    ...overrides,
  }
}

describe("buildConversationGroups", () => {
  it("should group a user message with following AI responses", () => {
    const userTurn = makeTurn({
      timestamp: "2026-05-07T19:22:45.000Z",
      messages: [{ type: "user", content: [{ type: "text", text: "Hello" }] }],
    })
    const aiTurn = makeTurn({
      timestamp: "2026-05-07T19:22:46.000Z",
      messages: [{ type: "assistant", content: [{ type: "text", text: "Hi!" }] }],
    })
    const groups = buildConversationGroups([userTurn, aiTurn])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.userMessage).toBe(userTurn)
    expect(groups[0]!.aiResponses).toEqual([aiTurn])
  })

  it("should handle AI-only turns (no user message) as orphan group", () => {
    const aiTurn = makeTurn({
      messages: [{ type: "assistant", content: [{ type: "text", text: "Thinking..." }] }],
    })
    const groups = buildConversationGroups([aiTurn])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.userMessage).toBeNull()
  })

  it("should create multiple groups for multiple user messages", () => {
    const turns = [
      makeTurn({ timestamp: "2026-05-07T19:22:45.000Z", messages: [{ type: "user", content: [{ type: "text", text: "Q1" }] }] }),
      makeTurn({ timestamp: "2026-05-07T19:22:46.000Z", messages: [{ type: "assistant", content: [{ type: "text", text: "A1" }] }] }),
      makeTurn({ timestamp: "2026-05-07T19:22:50.000Z", messages: [{ type: "user", content: [{ type: "text", text: "Q2" }] }] }),
      makeTurn({ timestamp: "2026-05-07T19:22:51.000Z", messages: [{ type: "assistant", content: [{ type: "text", text: "A2" }] }] }),
    ]
    const groups = buildConversationGroups(turns)
    expect(groups).toHaveLength(2)
    expect(groups[0]!.aiResponses).toHaveLength(1)
    expect(groups[1]!.aiResponses).toHaveLength(1)
  })
})

describe("buildTokenChartData", () => {
  it("should build data points from turns", () => {
    const turns = [
      makeTurn({ timestamp: "2026-05-07T19:22:45.000Z", tokenUsage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreation5mTokens: 5, cacheCreation1hTokens: 0 } }),
      makeTurn({ timestamp: "2026-05-07T19:22:46.000Z", tokenUsage: { inputTokens: 200, outputTokens: 80, cacheReadTokens: 20, cacheCreation5mTokens: 10, cacheCreation1hTokens: 0 } }),
    ]
    const data = buildTokenChartData(turns)
    expect(data).toHaveLength(2)
    expect(data[0]!.input).toBe(100)
    expect(data[1]!.output).toBe(80)
  })
})
```

**Step 2: Run test to verify failure**

```bash
cd web
pnpm vitest run src/lib/grouping.test.ts
```

Expected: FAIL — `buildConversationGroups` not found.

**Step 3: Implement `web/src/lib/grouping.ts`**

```typescript
import type { ConversationGroup, TokenDataPoint, Turn } from "./types"

/**
 * Check if a turn contains a real user message (not a tool result).
 */
function isUserTurn(turn: Turn): boolean {
  return turn.messages.some((m) => m.type === "user")
}

/**
 * Group turns into conversation blocks: one user message + all AI responses until the next user message.
 */
export function buildConversationGroups(turns: Turn[]): ConversationGroup[] {
  const groups: ConversationGroup[] = []
  let currentGroup: {
    userMessage: Turn | null
    aiResponses: Turn[]
  } | null = null

  for (const turn of turns) {
    if (isUserTurn(turn)) {
      // Save previous group
      if (currentGroup) {
        groups.push(finalizeGroup(currentGroup))
      }
      // Start new group
      currentGroup = { userMessage: turn, aiResponses: [] }
    } else {
      // AI response — add to current group
      if (!currentGroup) {
        currentGroup = { userMessage: null, aiResponses: [] }
      }
      currentGroup.aiResponses.push(turn)
    }
  }

  // Finalize last group
  if (currentGroup) {
    groups.push(finalizeGroup(currentGroup))
  }

  return groups
}

function finalizeGroup(group: { userMessage: Turn | null; aiResponses: Turn[] }): ConversationGroup {
  const allTurns = [group.userMessage, ...group.aiResponses].filter(Boolean) as Turn[]
  const first = allTurns[0]!
  const last = allTurns[allTurns.length - 1]!

  return {
    id: `group-${first.timestamp}`,
    userMessage: group.userMessage,
    aiResponses: group.aiResponses,
    startTime: first.timestamp,
    endTime: last.timestamp,
    durationMs: new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime(),
  }
}

/**
 * Build chart data points from turns for the token usage visualization.
 */
export function buildTokenChartData(turns: Turn[]): TokenDataPoint[] {
  return turns.map((turn, i) => ({
    turnIndex: i,
    timestamp: turn.timestamp,
    input: turn.tokenUsage.inputTokens,
    output: turn.tokenUsage.outputTokens,
    cacheRead: turn.tokenUsage.cacheReadTokens,
    cacheCreation:
      turn.tokenUsage.cacheCreation5mTokens + turn.tokenUsage.cacheCreation1hTokens,
  }))
}
```

**Step 4: Run test to verify pass**

```bash
cd web
pnpm vitest run src/lib/grouping.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add web/src/lib/grouping.ts web/src/lib/grouping.test.ts
git commit -m "feat(web): add conversation grouping and token chart data logic"
```

---

## Task 6: Create Zustand Store

**Objective:** Create the global state store for loaded session data.

**Files:**
- Create: `web/src/stores/session-store.ts`

**Step 1: Install Zustand**

```bash
cd web
pnpm add zustand
```

**Step 2: Create `web/src/stores/session-store.ts`**

```typescript
import { create } from "zustand"
import type {
  ConversationGroup,
  FullTimelineSession,
  TokenDataPoint,
} from "@/lib/types"
import { buildConversationGroups, buildTokenChartData } from "@/lib/grouping"

interface SessionState {
  /** Raw extractor output */
  raw: FullTimelineSession | null
  /** Conversation groups built from turns */
  groups: ConversationGroup[]
  /** Token chart data points */
  tokenChart: TokenDataPoint[]
  /** Whether a session is loaded */
  isLoaded: boolean
  /** Error message if loading failed */
  error: string | null

  /** Load a FullTimelineSession from a dropped JSON file */
  loadSession: (data: FullTimelineSession) => void
  /** Clear the loaded session */
  clearSession: () => void
}

export const useSessionStore = create<SessionState>((set) => ({
  raw: null,
  groups: [],
  tokenChart: [],
  isLoaded: false,
  error: null,

  loadSession: (data) => {
    try {
      const groups = buildConversationGroups(data.turns)
      const tokenChart = buildTokenChartData(data.turns)
      set({
        raw: data,
        groups,
        tokenChart,
        isLoaded: true,
        error: null,
      })
    } catch (err) {
      set({ error: `Failed to process session: ${String(err)}` })
    }
  },

  clearSession: () => {
    set({
      raw: null,
      groups: [],
      tokenChart: [],
      isLoaded: false,
      error: null,
    })
  },
}))
```

**Step 3: Commit**

```bash
git add web/src/stores/ web/package.json
git commit -m "feat(web): add Zustand session store"
```

---

## Task 7: Set Up TanStack Router

**Objective:** Install TanStack Router and configure file-based routing with the three routes.

**Files:**
- Create: `web/src/routeTree.gen.ts`
- Create: `web/src/routes/__root.tsx`
- Create: `web/src/routes/index.tsx`
- Create: `web/src/routes/session.$sessionId.tsx`
- Modify: `web/src/main.tsx`
- Modify: `web/src/App.tsx`

**Step 1: Install TanStack Router**

```bash
cd web
pnpm add @tanstack/react-router @tanstack/router-devtools
pnpm add -D @tanstack/router-plugin
```

**Step 2: Update `web/vite.config.ts`**

```typescript
import tailwindcss from "@tailwindcss/vite"
import { TanStackRouterVite } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [TanStackRouterVite({ quoteStyle: "double" }), tailwindcss(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
})
```

**Step 3: Create `web/src/routes/__root.tsx`**

```tsx
import { createRootRoute, Outlet } from "@tanstack/react-router"

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-surface-0 text-text-primary">
      <Outlet />
    </div>
  ),
})
```

**Step 4: Create `web/src/routes/index.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router"
import { DropZone } from "@/components/drop-zone"

export const Route = createFileRoute("/")({
  component: HomePage,
})

function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold tracking-tight">Claude Dash</h1>
      <p className="text-text-secondary">Drop a session JSON file to begin</p>
      <DropZone />
    </div>
  )
}
```

**Step 5: Create `web/src/routes/session.$sessionId.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router"
import { useSessionStore } from "@/stores/session-store"
import { AppShell } from "@/components/layout/app-shell"

export const Route = createFileRoute("/session/$sessionId")({
  component: SessionPage,
})

function SessionPage() {
  const isLoaded = useSessionStore((s) => s.isLoaded)

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-text-secondary">No session loaded. Drop a JSON file to begin.</p>
      </div>
    )
  }

  return <AppShell />
}
```

**Step 6: Update `web/src/main.tsx`**

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider, createRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"
import "./app.css"

const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
```

**Step 7: Delete `web/src/App.tsx`** (replaced by router)

**Step 8: Verify routes work**

Run `pnpm dev` — the landing page should render at `/`. Navigate to `/session/test` — should show "No session loaded" message.

**Step 9: Commit**

```bash
git add web/
git commit -m "feat(web): add TanStack Router with file-based routing"
```

---

## Task 8: Build the Drop Zone Component

**Objective:** Create the drag-and-drop file upload component that parses JSON and loads it into the store.

**Files:**
- Create: `web/src/components/drop-zone.tsx`
- Modify: `web/src/routes/index.tsx` (wire up navigation)

**Step 1: Create `web/src/components/drop-zone.tsx`**

```tsx
import { useCallback, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useSessionStore } from "@/stores/session-store"
import type { FullTimelineSession } from "@/lib/types"
import { cn } from "@/lib/utils"

export function DropZone() {
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const loadSession = useSessionStore((s) => s.loadSession)
  const navigate = useNavigate()

  const handleFile = useCallback(
    async (file: File) => {
      setIsLoading(true)
      setError(null)
      try {
        const text = await file.text()
        const data = JSON.parse(text) as FullTimelineSession
        loadSession(data)
        navigate({ to: "/session/$sessionId", params: { sessionId: data.session.sessionId } })
      } catch (err) {
        setError(`Invalid JSON file: ${String(err)}`)
      } finally {
        setIsLoading(false)
      }
    },
    [loadSession, navigate],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const onDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const onClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={onClick}
      className={cn(
        "flex h-64 w-full max-w-lg cursor-pointer flex-col items-center justify-center gap-3",
        "rounded-xl border-2 border-dashed transition-colors",
        isDragging
          ? "border-brand-400 bg-brand-500/10"
          : "border-border hover:border-brand-500 hover:bg-surface-2",
        isLoading && "pointer-events-none opacity-50",
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={onFileChange}
      />
      <svg className="h-10 w-10 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
      </svg>
      <p className="text-sm text-text-secondary">
        {isLoading ? "Processing..." : "Drag & drop session JSON or click to browse"}
      </p>
      {error && <p className="text-sm text-accent-red">{error}</p>}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add web/src/components/drop-zone.tsx
git commit -m "feat(web): add drag-and-drop zone for session JSON"
```

---

## Task 9: Build the App Shell Layout

**Objective:** Create the main layout with collapsible sidebar and content area.

**Files:**
- Create: `web/src/components/layout/app-shell.tsx`
- Create: `web/src/components/layout/sidebar.tsx`

**Step 1: Create `web/src/components/layout/sidebar.tsx`**

```tsx
import { useSessionStore } from "@/stores/session-store"
import { formatTokens, formatCost, formatTimestamp } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface SidebarProps {
  open: boolean
  onToggle: () => void
}

export function Sidebar({ open, onToggle }: SidebarProps) {
  const raw = useSessionStore((s) => s.raw)
  const clearSession = useSessionStore((s) => s.clearSession)

  if (!raw) return null

  const { session, pricing } = raw

  return (
    <aside
      className={`flex h-full flex-col border-r border-border bg-surface-1 transition-all duration-200 ${
        open ? "w-64" : "w-0 overflow-hidden"
      }`}
    >
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="text-sm font-semibold">Session</h2>
        <Button variant="ghost" size="icon" onClick={onToggle}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        <div className="space-y-1">
          <SidebarLink label="Overview" active />
          <SidebarLink label="Timeline" />
          <SidebarLink label="Token Usage" />
          <SidebarLink label="Cost Breakdown" />
        </div>

        <div className="mt-6 space-y-3 text-xs text-text-secondary">
          <div>
            <span className="text-text-muted">Model</span>
            <p className="mt-0.5 font-medium text-text-primary">{session.model}</p>
          </div>
          <div>
            <span className="text-text-muted">Turns</span>
            <p className="mt-0.5 font-medium text-text-primary">{session.turnCount}</p>
          </div>
          <div>
            <span className="text-text-muted">Total Cost</span>
            <p className="mt-0.5 font-medium text-accent-green">{formatCost(pricing.totalCost)}</p>
          </div>
          <div>
            <span className="text-text-muted">Tokens</span>
            <p className="mt-0.5 font-medium text-text-primary">
              {formatTokens(session.totalTokens.inputTokens + session.totalTokens.outputTokens)}
            </p>
          </div>
          <div>
            <span className="text-text-muted">Duration</span>
            <p className="mt-0.5 font-medium text-text-primary">
              {formatTimestamp(session.startTime)} — {formatTimestamp(session.endTime)}
            </p>
          </div>
        </div>
      </nav>

      <div className="border-t border-border p-3">
        <Button variant="outline" size="sm" className="w-full" onClick={clearSession}>
          New Session
        </Button>
      </div>
    </aside>
  )
}

function SidebarLink({ label, active }: { label: string; active?: boolean }) {
  return (
    <button
      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        active
          ? "bg-brand-600/15 text-brand-400"
          : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
      }`}
    >
      {label}
    </button>
  )
}
```

**Step 2: Create `web/src/components/layout/app-shell.tsx`**

```tsx
import { useState } from "react"
import { Sidebar } from "./sidebar"
import { OverviewCard } from "@/components/session/overview-card"
import { Timeline } from "@/components/session/timeline"
import { TokenChart } from "@/components/session/token-chart"
import { CostBreakdown } from "@/components/session/cost-breakdown"
import { useSessionStore } from "@/stores/session-store"
import { Button } from "@/components/ui/button"

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const raw = useSessionStore((s) => s.raw)

  if (!raw) return null

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((o) => !o)} />

      <main className="flex-1 overflow-y-auto">
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-surface-0/80 px-6 py-3 backdrop-blur">
          {!sidebarOpen && (
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </Button>
          )}
          <h1 className="text-sm font-semibold">{raw.session.sessionId.slice(0, 8)}…</h1>
          <span className="text-xs text-text-muted">{raw.session.model}</span>
        </div>

        {/* Content */}
        <div className="mx-auto max-w-5xl space-y-6 p-6">
          <OverviewCard />
          <TokenChart />
          <Timeline />
          <CostBreakdown />
        </div>
      </main>
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add web/src/components/layout/
git commit -m "feat(web): add app shell layout with sidebar"
```

---

## Task 10: Build the Overview Card

**Objective:** Create the session summary card showing key metrics at a glance.

**Files:**
- Create: `web/src/components/session/overview-card.tsx`

**Step 1: Create `web/src/components/session/overview-card.tsx`**

```tsx
import { useSessionStore } from "@/stores/session-store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatTokens, formatCost, formatDuration } from "@/lib/utils"

export function OverviewCard() {
  const raw = useSessionStore((s) => s.raw)
  if (!raw) return null

  const { session, pricing } = raw
  const duration =
    new Date(session.endTime).getTime() - new Date(session.startTime).getTime()

  const totalTokens =
    session.totalTokens.inputTokens +
    session.totalTokens.outputTokens +
    session.totalTokens.cacheReadTokens +
    session.totalTokens.cacheCreation5mTokens +
    session.totalTokens.cacheCreation1hTokens

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle>Session Overview</CardTitle>
          <Badge variant="info">{session.model}</Badge>
          {session.commandExecuted && (
            <Badge variant="secondary">{session.commandExecuted}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label="Total Cost" value={formatCost(pricing.totalCost)} color="text-accent-green" />
          <Metric label="Total Tokens" value={formatTokens(totalTokens)} />
          <Metric label="Turns" value={String(session.turnCount)} />
          <Metric label="Duration" value={formatDuration(duration)} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MiniMetric label="Input" value={formatTokens(session.totalTokens.inputTokens)} />
          <MiniMetric label="Output" value={formatTokens(session.totalTokens.outputTokens)} />
          <MiniMetric label="Cache Read" value={formatTokens(session.totalTokens.cacheReadTokens)} />
          <MiniMetric
            label="Cache Write"
            value={formatTokens(
              session.totalTokens.cacheCreation5mTokens + session.totalTokens.cacheCreation1hTokens,
            )}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-xs text-text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${color ?? "text-text-primary"}`}>{value}</p>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-1 text-sm font-medium text-text-secondary">{value}</p>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add web/src/components/session/overview-card.tsx
git commit -m "feat(web): add session overview card"
```

---

## Task 11: Build the Timeline Component

**Objective:** Create the conversation timeline with expandable tool calls.

**Files:**
- Create: `web/src/components/session/timeline.tsx`
- Create: `web/src/components/session/conversation-group.tsx`
- Create: `web/src/components/session/turn-card.tsx`
- Create: `web/src/components/session/tool-call.tsx`
- Create: `web/src/components/session/token-badge.tsx`

**Step 1: Create `web/src/components/session/token-badge.tsx`**

```tsx
import { Badge } from "@/components/ui/badge"
import { formatTokens } from "@/lib/utils"
import type { TokenUsage } from "@/lib/types"

interface TokenBadgeProps {
  usage: TokenUsage
}

export function TokenBadge({ usage }: TokenBadgeProps) {
  const total = usage.inputTokens + usage.outputTokens
  return (
    <Badge variant="secondary" className="font-mono text-[10px]">
      {formatTokens(total)}
    </Badge>
  )
}
```

**Step 2: Create `web/src/components/session/tool-call.tsx`**

```tsx
import { useState } from "react"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import type { ToolCall as ToolCallType } from "@/lib/types"

interface ToolCallProps {
  toolCall: ToolCallType
}

const toolColors: Record<string, string> = {
  Read: "text-accent-blue",
  Edit: "text-accent-orange",
  Bash: "text-accent-green",
  Write: "text-accent-purple",
  Task: "text-accent-red",
}

export function ToolCall({ toolCall }: ToolCallProps) {
  const [open, setOpen] = useState(false)
  const color = toolColors[toolCall.name] ?? "text-text-secondary"

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2">
        <svg
          className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <Badge variant="secondary" className={color}>
          {toolCall.name}
        </Badge>
        <span className="truncate text-text-secondary">
          {getToolSummary(toolCall)}
        </span>
        {toolCall.isError && <Badge variant="error">error</Badge>}
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-6 border-l border-border pl-3">
        <div className="space-y-2 py-2">
          <div>
            <p className="mb-1 text-xs font-medium text-text-muted">Input</p>
            <pre className="overflow-x-auto rounded-lg bg-surface-0 p-3 text-xs text-text-secondary">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>
          {toolCall.result && (
            <div>
              <p className="mb-1 text-xs font-medium text-text-muted">Result</p>
              <pre className="max-h-64 overflow-auto rounded-lg bg-surface-0 p-3 text-xs text-text-secondary">
                {toolCall.result}
              </pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function getToolSummary(toolCall: ToolCallType): string {
  const input = toolCall.input
  switch (toolCall.name) {
    case "Read":
    case "Write":
    case "Edit":
      return String(input.filePath ?? input.file_path ?? "")
    case "Bash":
      return String(input.command ?? "").slice(0, 80)
    case "Task":
      return String(input.description ?? "").slice(0, 80)
    case "Glob":
    case "Grep":
      return String(input.pattern ?? input.query ?? "").slice(0, 80)
    default:
      return ""
  }
}
```

**Step 3: Create `web/src/components/session/turn-card.tsx`**

```tsx
import { Card } from "@/components/ui/card"
import { TokenBadge } from "./token-badge"
import { ToolCall } from "./tool-call"
import { formatTimestamp } from "@/lib/utils"
import type { Turn } from "@/lib/types"

interface TurnCardProps {
  turn: Turn
  index: number
}

export function TurnCard({ turn, index }: TurnCardProps) {
  const hasUserMessage = turn.messages.some((m) => m.type === "user")
  const textContent = turn.messages
    .flatMap((m) =>
      m.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text),
    )
    .join("\n")

  return (
    <Card className="py-3">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            hasUserMessage
              ? "bg-accent-blue/20 text-accent-blue"
              : "bg-accent-green/20 text-accent-green"
          }`}
        >
          {hasUserMessage ? "U" : "A"}
        </div>

        <div className="min-w-0 flex-1">
          {/* Header */}
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>{formatTimestamp(turn.timestamp)}</span>
            <span>·</span>
            <span>Turn {index + 1}</span>
            {turn.toolName && (
              <>
                <span>·</span>
                <span>{turn.toolName}</span>
              </>
            )}
            <div className="ml-auto">
              <TokenBadge usage={turn.tokenUsage} />
            </div>
          </div>

          {/* Text content */}
          {textContent && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-text-primary">{textContent}</p>
          )}

          {/* Tool calls */}
          {turn.toolCalls.length > 0 && (
            <div className="mt-2 space-y-1">
              {turn.toolCalls.map((tc) => (
                <ToolCall key={tc.toolUseId} toolCall={tc} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
```

**Step 4: Create `web/src/components/session/conversation-group.tsx`**

```tsx
import { TurnCard } from "./turn-card"
import { formatDuration } from "@/lib/utils"
import type { ConversationGroup as GroupType } from "@/lib/types"

interface ConversationGroupProps {
  group: GroupType
  turnOffset: number
}

export function ConversationGroup({ group, turnOffset }: ConversationGroupProps) {
  return (
    <div className="space-y-2">
      {/* Group header */}
      {group.userMessage && (
        <TurnCard turn={group.userMessage} index={turnOffset} />
      )}

      {/* AI responses */}
      {group.aiResponses.map((turn, i) => (
        <TurnCard key={turn.timestamp} turn={turn} index={turnOffset + i + 1} />
      ))}

      {/* Group footer — duration */}
      {group.durationMs > 0 && (
        <div className="flex justify-end">
          <span className="text-xs text-text-muted">
            {formatDuration(group.durationMs)}
          </span>
        </div>
      )}
    </div>
  )
}
```

**Step 5: Create `web/src/components/session/timeline.tsx`**

```tsx
import { useSessionStore } from "@/stores/session-store"
import { ConversationGroup } from "./conversation-group"

export function Timeline() {
  const groups = useSessionStore((s) => s.groups)

  if (groups.length === 0) {
    return (
      <div className="py-12 text-center text-text-muted">
        No conversation data to display.
      </div>
    )
  }

  let turnOffset = 0

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Timeline</h2>
      <div className="space-y-8">
        {groups.map((group) => {
          const offset = turnOffset
          const groupSize = 1 + group.aiResponses.length
          turnOffset += groupSize
          return (
            <ConversationGroup key={group.id} group={group} turnOffset={offset} />
          )
        })}
      </div>
    </div>
  )
}
```

**Step 6: Commit**

```bash
git add web/src/components/session/
git commit -m "feat(web): add timeline with conversation groups and tool calls"
```

---

## Task 12: Build Token Usage Chart

**Objective:** Create a simple bar chart showing token distribution across turns.

**Files:**
- Create: `web/src/components/session/token-chart.tsx`

**Step 1: Create `web/src/components/session/token-chart.tsx`**

```tsx
import { useSessionStore } from "@/stores/session-store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatTokens } from "@/lib/utils"

export function TokenChart() {
  const tokenChart = useSessionStore((s) => s.tokenChart)

  if (tokenChart.length === 0) return null

  const maxValue = Math.max(
    ...tokenChart.map((d) => d.input + d.output + d.cacheRead + d.cacheCreation),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Token Usage</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mt-4 flex items-end gap-1" style={{ height: 160 }}>
          {tokenChart.map((d) => {
            const total = d.input + d.output + d.cacheRead + d.cacheCreation
            const height = maxValue > 0 ? (total / maxValue) * 100 : 0
            return (
              <div
                key={d.turnIndex}
                className="group relative flex-1"
                style={{ height: `${height}%` }}
              >
                {/* Stacked bars */}
                <div className="flex h-full flex-col justify-end">
                  {d.cacheCreation > 0 && (
                    <div
                      className="bg-accent-purple/60"
                      style={{ height: `${(d.cacheCreation / total) * 100}%` }}
                    />
                  )}
                  {d.cacheRead > 0 && (
                    <div
                      className="bg-accent-blue/60"
                      style={{ height: `${(d.cacheRead / total) * 100}%` }}
                    />
                  )}
                  {d.output > 0 && (
                    <div
                      className="bg-accent-orange/60"
                      style={{ height: `${(d.output / total) * 100}%` }}
                    />
                  )}
                  {d.input > 0 && (
                    <div
                      className="bg-accent-green/60"
                      style={{ height: `${(d.input / total) * 100}%` }}
                    />
                  )}
                </div>

                {/* Tooltip */}
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-surface-3 p-2 text-xs shadow-lg group-hover:block">
                  <p className="font-medium">Turn {d.turnIndex + 1}</p>
                  <p className="text-accent-green">Input: {formatTokens(d.input)}</p>
                  <p className="text-accent-orange">Output: {formatTokens(d.output)}</p>
                  <p className="text-accent-blue">Cache Read: {formatTokens(d.cacheRead)}</p>
                  <p className="text-accent-purple">Cache Write: {formatTokens(d.cacheCreation)}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-text-secondary">
          <LegendItem color="bg-accent-green/60" label="Input" />
          <LegendItem color="bg-accent-orange/60" label="Output" />
          <LegendItem color="bg-accent-blue/60" label="Cache Read" />
          <LegendItem color="bg-accent-purple/60" label="Cache Write" />
        </div>
      </CardContent>
    </Card>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`h-2.5 w-2.5 rounded-sm ${color}`} />
      <span>{label}</span>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add web/src/components/session/token-chart.tsx
git commit -m "feat(web): add token usage bar chart"
```

---

## Task 13: Build Cost Breakdown

**Objective:** Create a per-turn cost breakdown table.

**Files:**
- Create: `web/src/components/session/cost-breakdown.tsx`

**Step 1: Create `web/src/components/session/cost-breakdown.tsx`**

```tsx
import { useSessionStore } from "@/stores/session-store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCost, formatTimestamp } from "@/lib/utils"

export function CostBreakdown() {
  const raw = useSessionStore((s) => s.raw)
  if (!raw) return null

  const { pricing, turns } = raw

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Cost Breakdown</CardTitle>
          <span className="text-lg font-semibold text-accent-green">
            {formatCost(pricing.totalCost)}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-text-muted">
                <th className="pb-2 pr-4">Turn</th>
                <th className="pb-2 pr-4">Time</th>
                <th className="pb-2 pr-4 text-right">Input</th>
                <th className="pb-2 pr-4 text-right">Output</th>
                <th className="pb-2 pr-4 text-right">Cache R</th>
                <th className="pb-2 pr-4 text-right">Cache W</th>
                <th className="pb-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {pricing.turnsPricing.map((tp, i) => (
                <tr key={i} className="border-b border-border-subtle">
                  <td className="py-2 pr-4 font-medium">{i + 1}</td>
                  <td className="py-2 pr-4 text-text-secondary">
                    {turns[i] ? formatTimestamp(turns[i]!.timestamp) : "—"}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono">{formatCost(tp.inputCost)}</td>
                  <td className="py-2 pr-4 text-right font-mono">{formatCost(tp.outputCost)}</td>
                  <td className="py-2 pr-4 text-right font-mono">{formatCost(tp.cacheReadCost)}</td>
                  <td className="py-2 pr-4 text-right font-mono">{formatCost(tp.cacheCreation5mCost + tp.cacheCreation1hCost)}</td>
                  <td className="py-2 text-right font-mono font-medium text-text-primary">
                    {formatCost(tp.totalCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
```

**Step 2: Commit**

```bash
git add web/src/components/session/cost-breakdown.tsx
git commit -m "feat(web): add cost breakdown table"
```

---

## Task 14: Add to Root Workspace and Final Verification

**Objective:** Ensure the monorepo workspace includes `web/`, verify everything builds and runs.

**Files:**
- Modify: `package.json` (root)

**Step 1: Verify root workspace includes web**

Already done in Task 1 Step 13.

**Step 2: Run lint**

```bash
cd web
pnpm lint
```

Expected: No errors (or fix any that appear).

**Step 3: Run typecheck**

```bash
cd web
pnpm tsc -b
```

Expected: No type errors.

**Step 4: Run tests**

```bash
cd web
pnpm test
```

Expected: All tests pass (grouping tests).

**Step 5: Run dev server and manually test**

```bash
cd web
pnpm dev
```

1. Open http://localhost:3000
2. Drag a session JSON file onto the drop zone
3. Verify: navigates to `/session/:id`
4. Verify: overview card shows model, cost, tokens, duration
5. Verify: token chart renders bars
6. Verify: timeline shows conversation groups
7. Verify: tool calls expand/collapse
8. Verify: cost breakdown table renders

**Step 6: Commit**

```bash
git add .
git commit -m "feat(web): final integration and verification"
```

---

## Risks and Tradeoffs

| Risk | Mitigation |
|------|-----------|
| BaseUI API may differ from Radix | shadcn wrapper pattern abstracts this — swap internals without changing consumer code |
| Tailwind v4 breaking changes | Pin version, use `@theme` directive (v4 syntax) |
| Large JSON files may be slow to parse | Use `JSON.parse` on dropped file — fast enough for single sessions. Optimize later if needed |
| Conversation grouping may edge-case | Tests cover main scenarios. Real data may reveal edge cases — iterate. |
| TanStack Router file-based routing requires codegen | `routeTree.gen.ts` is auto-generated — just run `pnpm dev` once to generate |

## Open Questions (for future sessions)

1. **Search/filter** — Cmd+K search across turns? (claude-devtools has this)
2. **Multi-session comparison** — side-by-side view?
3. **Session list page** — use `--list-sessions` output?
4. **Export** — export filtered views as Markdown/JSON?
5. **Charts upgrade** — switch to a proper charting library (Recharts, Visx) for the token chart?
