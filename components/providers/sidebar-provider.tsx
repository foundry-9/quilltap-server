'use client'

/**
 * Sidebar Provider
 *
 * Provides sidebar context. The sidebar is now always collapsed,
 * so most state management is simplified to no-ops.
 * The interface is kept stable since 27+ files import useSidebar.
 *
 * @module components/providers/sidebar-provider
 */

import { createContext, useCallback, useContext, useMemo } from 'react'

/** Default sidebar width in pixels */
export const DEFAULT_SIDEBAR_WIDTH = 256
/** Minimum sidebar width in pixels */
export const MIN_SIDEBAR_WIDTH = 256
/** Maximum sidebar width in pixels */
export const MAX_SIDEBAR_WIDTH = 512

interface SidebarContextValue {
  /** Whether the sidebar is collapsed (always true) */
  isCollapsed: boolean
  /** Current sidebar width in pixels */
  width: number
  /** Toggle collapsed state (no-op) */
  toggleCollapse: () => void
  /** Set collapsed state explicitly (no-op) */
  setCollapsed: (collapsed: boolean) => void
  /** Set sidebar width (no-op) */
  setWidth: (width: number) => void
  /** Reset sidebar width to default (no-op) */
  resetWidth: () => void
  /** Which sections are collapsed (by section id) */
  sectionCollapsed: Record<string, boolean>
  /** Toggle a section's collapsed state (no-op) */
  toggleSectionCollapsed: (sectionId: string) => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

const EMPTY_SECTIONS: Record<string, boolean> = {}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // No-op callbacks — sidebar is always collapsed
  const noop = useCallback(() => {}, [])
  const noopBoolean = useCallback((_collapsed: boolean) => {}, [])
  const noopNumber = useCallback((_width: number) => {}, [])
  const noopString = useCallback((_sectionId: string) => {}, [])

  const value = useMemo<SidebarContextValue>(
    () => ({
      isCollapsed: true,
      width: DEFAULT_SIDEBAR_WIDTH,
      toggleCollapse: noop,
      setCollapsed: noopBoolean,
      setWidth: noopNumber,
      resetWidth: noop,
      sectionCollapsed: EMPTY_SECTIONS,
      toggleSectionCollapsed: noopString,
    }),
    [noop, noopBoolean, noopNumber, noopString]
  )

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) {
    throw new Error('useSidebar must be used within a SidebarProvider')
  }
  return ctx
}

/**
 * Optional hook that returns null if used outside provider context.
 * Useful for components that may be rendered before provider is mounted.
 */
export function useSidebarOptional() {
  return useContext(SidebarContext)
}
