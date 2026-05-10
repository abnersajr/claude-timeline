import type { ReactNode } from 'react'
import { Sidebar } from './sidebar'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Sidebar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
