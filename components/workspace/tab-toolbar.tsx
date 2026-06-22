'use client'

/**
 * Per-tab page toolbar (tabbed workspace).
 *
 * The legacy app has a single global `PageToolbar`. With two panes each showing
 * a different surface, the contextual toolbar content a surface injects (via
 * `usePageToolbar`) must be tracked **per tab** and rendered into the owning
 * pane's toolbar strip.
 *
 * Design: a workspace-level registry holds each tab's injected left/right
 * content keyed by tab id. {@link TabToolbarProvider} wraps each mounted tab's
 * view and supplies the *same* `PageToolbarContext` — so `usePageToolbar()`
 * inside the view resolves to the per-tab provider and writes into the registry
 * with no change to the call site. {@link PaneToolbar} renders a pane's active
 * tab's content out of the registry.
 *
 * @module components/workspace/tab-toolbar
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  PageToolbarContext,
  type PageToolbarContextValue,
} from '@/components/providers/page-toolbar-provider'

type ToolbarSide = 'left' | 'right'
interface ToolbarSlots {
  left: ReactNode | null
  right: ReactNode | null
}

interface TabToolbarRegistryValue {
  toolbars: Record<string, ToolbarSlots>
  setSlot: (tabId: string, side: ToolbarSide, content: ReactNode | null) => void
  clearTab: (tabId: string) => void
}

const TabToolbarRegistryContext = createContext<TabToolbarRegistryValue | null>(null)

/**
 * Holds the per-tab toolbar content. Rendered once by the workspace host, above
 * the pane/tab tree. Panes read it via {@link PaneToolbar}; tab views write to
 * it via {@link TabToolbarProvider}.
 */
export function TabToolbarRegistryProvider({ children }: { children: ReactNode }) {
  const [toolbars, setToolbars] = useState<Record<string, ToolbarSlots>>({})

  const setSlot = useCallback(
    (tabId: string, side: ToolbarSide, content: ReactNode | null) => {
      setToolbars((prev) => {
        const existing = prev[tabId] ?? { left: null, right: null }
        if (existing[side] === content) return prev
        return { ...prev, [tabId]: { ...existing, [side]: content } }
      })
    },
    []
  )

  const clearTab = useCallback((tabId: string) => {
    setToolbars((prev) => {
      if (!(tabId in prev)) return prev
      const next = { ...prev }
      delete next[tabId]
      return next
    })
  }, [])

  const value = useMemo<TabToolbarRegistryValue>(
    () => ({ toolbars, setSlot, clearTab }),
    [toolbars, setSlot, clearTab]
  )

  return (
    <TabToolbarRegistryContext.Provider value={value}>
      {children}
    </TabToolbarRegistryContext.Provider>
  )
}

function useTabToolbarRegistry(): TabToolbarRegistryValue {
  const ctx = useContext(TabToolbarRegistryContext)
  if (!ctx) {
    throw new Error('useTabToolbarRegistry must be used within a TabToolbarRegistryProvider')
  }
  return ctx
}

/**
 * Wraps a single mounted tab's view. Supplies a `PageToolbarContext` whose
 * setters write into the registry under this tab's id, so existing
 * `usePageToolbar()` consumers work unchanged. Clears its registry entry on
 * unmount (i.e. when the tab is closed).
 */
export function TabToolbarProvider({
  tabId,
  children,
}: {
  tabId: string
  children: ReactNode
}) {
  const { toolbars, setSlot, clearTab } = useTabToolbarRegistry()

  const setLeftContent = useCallback(
    (content: ReactNode | null) => setSlot(tabId, 'left', content),
    [setSlot, tabId]
  )
  const setRightContent = useCallback(
    (content: ReactNode | null) => setSlot(tabId, 'right', content),
    [setSlot, tabId]
  )

  useEffect(() => {
    return () => clearTab(tabId)
  }, [clearTab, tabId])

  const slots = toolbars[tabId]
  const value = useMemo<PageToolbarContextValue>(
    () => ({
      leftContent: slots?.left ?? null,
      rightContent: slots?.right ?? null,
      setLeftContent,
      setRightContent,
    }),
    [slots?.left, slots?.right, setLeftContent, setRightContent]
  )

  return <PageToolbarContext.Provider value={value}>{children}</PageToolbarContext.Provider>
}

/**
 * Reads the toolbar content a given (active) tab injected and renders its left
 * and right slots. The shared chrome (search bar, global badges, width toggle)
 * lives in the workspace top chrome, not here, so a split shows that chrome once
 * while each pane carries its own surface's contextual controls.
 */
export function PaneToolbar({ activeTabId }: { activeTabId: string | null }) {
  const { toolbars } = useTabToolbarRegistry()
  const slots = activeTabId ? toolbars[activeTabId] : null
  const left = slots?.left ?? null
  const right = slots?.right ?? null

  if (!left && !right) return null

  return (
    <div className="qt-pane-toolbar">
      <div className="qt-pane-toolbar-left">{left}</div>
      <div className="qt-pane-toolbar-right">{right}</div>
    </div>
  )
}
