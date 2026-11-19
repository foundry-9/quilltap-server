'use client'

/**
 * The rail's shared state: which flyout is open (one at a time), the
 * standalone document picker, and `activate(id)` — the one way a navigation
 * item is chosen, whether from a rail button, a flyout row or the Electron
 * shell's native menu (`window.quilltap.onNavigate`, registered here).
 *
 * @module components/layout/left-sidebar/nav-rail-context
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { useHelpChatOptional } from '@/components/providers/help-chat-provider'
import { useBrahmaConsoleOptional } from '@/components/providers/brahma-console-provider'
import { useWardrobeDialogOptional } from '@/components/providers/wardrobe-dialog-provider'
import { useInventoryDialogOptional } from '@/components/providers/inventory-dialog-provider'
import { useAtlasDialogOptional } from '@/components/providers/atlas-dialog-provider'
import { useNewChatModalOptional } from '@/components/providers/new-chat-provider'
import { findNavItem, isNavItemId, type NavGroupId, type NavItemId } from '@/lib/navigation/registry'
import { activatorFor, navAvailability, type NavActivatorContext, type NavAvailability, type NavPanelId } from './activators'

/** A flyout: one of the four menus, a panel, or the profile menu. */
export type NavMenuId = NavGroupId | NavPanelId | 'profile-menu'

export interface OpenNavMenu {
  id: NavMenuId
  /** The `data-nav` of the rail button the flyout hangs from (focus returns there). */
  anchor: string
  /** Focus the first row on open (keyboard), else the flyout itself. */
  focusFirst: boolean
}

interface NavRailValue {
  openMenu: OpenNavMenu | null
  openFlyout: (id: NavMenuId, anchor: string, opts?: { focusFirst?: boolean }) => void
  toggleFlyout: (id: NavMenuId, anchor: string, opts?: { focusFirst?: boolean }) => void
  /** Close the open flyout; focus returns to its rail button unless told otherwise. */
  closeFlyout: (opts?: { restoreFocus?: boolean }) => void
  activate: (id: NavItemId) => void
  availability: (id: NavItemId) => NavAvailability
  showDocumentPicker: boolean
  setShowDocumentPicker: (show: boolean) => void
}

const NavRailContext = createContext<NavRailValue | null>(null)

/** Where each panel hangs when nothing more specific is on hand. */
const PANEL_ANCHOR: Record<NavPanelId, string> = { themes: 'studio', 'quick-hide': 'quick-hide' }

export function railButtonFor(anchor: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const buttons = document.querySelectorAll<HTMLElement>('.qt-left-sidebar [data-nav]')
  return Array.from(buttons).find((button) => button.dataset.nav === anchor) ?? null
}

export function NavRailProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const ws = useWorkspaceOptional()
  const helpChat = useHelpChatOptional()
  const brahmaConsole = useBrahmaConsoleOptional()
  const wardrobeDialog = useWardrobeDialogOptional()
  const inventoryDialog = useInventoryDialogOptional()
  const atlasDialog = useAtlasDialogOptional()
  const newChat = useNewChatModalOptional()
  const queryClient = useQueryClient()

  const [openMenu, setOpenMenu] = useState<OpenNavMenu | null>(null)
  const [showDocumentPicker, setShowDocumentPicker] = useState(false)

  const openFlyout = useCallback((id: NavMenuId, anchor: string, opts?: { focusFirst?: boolean }) => {
    setOpenMenu({ id, anchor, focusFirst: Boolean(opts?.focusFirst) })
  }, [])

  const toggleFlyout = useCallback((id: NavMenuId, anchor: string, opts?: { focusFirst?: boolean }) => {
    setOpenMenu((prev) => (prev?.id === id ? null : { id, anchor, focusFirst: Boolean(opts?.focusFirst) }))
  }, [])

  const openMenuRef = useRef<OpenNavMenu | null>(null)
  useEffect(() => {
    openMenuRef.current = openMenu
  }, [openMenu])

  const closeFlyout = useCallback((opts?: { restoreFocus?: boolean }) => {
    const anchor = openMenuRef.current?.anchor
    setOpenMenu(null)
    if (anchor && opts?.restoreFocus !== false) {
      // After the flyout unmounts, so focus lands on a button that is there.
      setTimeout(() => railButtonFor(anchor)?.focus(), 0)
    }
  }, [])

  // The activator context reads the latest provider values through a ref, so
  // `activate` keeps one identity (the bridge registers it once).
  const deps = useMemo<Omit<NavActivatorContext, 'item'>>(
    () => ({
      workspace: ws && pathname === '/workspace' ? ws : null,
      pathname,
      navigate: (href) => window.location.assign(href),
      helpChat,
      brahmaConsole,
      wardrobeDialog,
      inventoryDialog,
      atlasDialog,
      newChat,
      queryClient,
      openPanel: (panel) => {
        setOpenMenu((prev) => ({ id: panel, anchor: prev?.anchor ?? PANEL_ANCHOR[panel], focusFirst: true }))
      },
      openDocumentPicker: () => setShowDocumentPicker(true),
    }),
    [ws, pathname, helpChat, brahmaConsole, wardrobeDialog, inventoryDialog, atlasDialog, newChat, queryClient],
  )
  const depsRef = useRef(deps)
  useEffect(() => {
    depsRef.current = deps
  }, [deps])

  const activate = useCallback((id: NavItemId) => {
    const item = findNavItem(id)
    const current = depsRef.current
    if (!item) return
    if (navAvailability(id, current).disabled) {
      console.debug('[nav] Item not available, ignoring', { id })
      return
    }
    // A panel replaces the flyout it was chosen from; anything else closes it.
    if (item.target.type !== 'action' || (item.target.action !== 'themes' && item.target.action !== 'quick-hide')) {
      setOpenMenu(null)
    }
    void Promise.resolve(activatorFor(item)({ ...current, item })).catch((error) => {
      console.error('[nav] Activator failed', { id, error })
    })
  }, [])

  const availability = useCallback(
    (id: NavItemId) => navAvailability(id, { helpChat, brahmaConsole }),
    [helpChat, brahmaConsole],
  )

  // The Electron shell's native menu sends an item id; it runs the very same
  // activator. A shell without the bridge method simply never calls it.
  useEffect(() => {
    const register = typeof window !== 'undefined' ? window.quilltap?.onNavigate : undefined
    if (!register) return
    const unsubscribe = register((itemId) => {
      if (!isNavItemId(itemId)) {
        console.warn('[nav] Native menu sent an unknown item id', { itemId })
        return
      }
      activate(itemId)
    })
    return typeof unsubscribe === 'function' ? unsubscribe : undefined
  }, [activate])

  const value = useMemo<NavRailValue>(
    () => ({ openMenu, openFlyout, toggleFlyout, closeFlyout, activate, availability, showDocumentPicker, setShowDocumentPicker }),
    [openMenu, openFlyout, toggleFlyout, closeFlyout, activate, availability, showDocumentPicker],
  )

  return <NavRailContext.Provider value={value}>{children}</NavRailContext.Provider>
}

export function useNavRail(): NavRailValue {
  const value = useContext(NavRailContext)
  if (!value) throw new Error('useNavRail must be used inside NavRailProvider')
  return value
}
