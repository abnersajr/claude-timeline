import { create } from "zustand"

export type ViewMode = "turns" | "conversations"

interface UIState {
  sidebarOpen: boolean
  viewMode: ViewMode
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setViewMode: (mode: ViewMode) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  viewMode: "turns",
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setViewMode: (mode) => set({ viewMode: mode }),
}))
