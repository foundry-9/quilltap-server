'use client'

/**
 * Inventory Dialog Provider
 *
 * Hosts the global Inventory dialog (Pascal the Croupier's). Any component in
 * the authenticated layout can summon it with `useInventoryDialog().open()`,
 * passing an optional character to preselect, a chat (which adds the equip
 * controls and the *Carrying now* pane) or a project or group to browse.
 * Mirrors `WardrobeDialogProvider`.
 *
 * @module components/providers/inventory-dialog-provider
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

export interface InventoryDialogContext {
  /** Preselect this character. */
  characterId?: string
  /** When set, the dialog shows equip controls and *Carrying now* for this chat. */
  chatId?: string
  /** Browse this project's store (or name the project tier for a character). */
  projectId?: string
  /** Browse this group's store. */
  groupId?: string
}

interface InventoryDialogContextValue {
  isOpen: boolean
  context: InventoryDialogContext | null
  open: (ctx?: InventoryDialogContext) => void
  close: () => void
}

const InventoryDialogCtx = createContext<InventoryDialogContextValue | null>(null)

export function InventoryDialogProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [context, setContext] = useState<InventoryDialogContext | null>(null)
  const open = useCallback((ctx?: InventoryDialogContext) => {
    setContext(ctx ?? null)
    setIsOpen(true)
  }, [])
  const close = useCallback(() => setIsOpen(false), [])
  return <InventoryDialogCtx.Provider value={{ isOpen, context, open, close }}>{children}</InventoryDialogCtx.Provider>
}

/** The Inventory dialog. Throws outside the provider. */
export function useInventoryDialog(): InventoryDialogContextValue {
  const v = useContext(InventoryDialogCtx)
  if (!v) throw new Error('useInventoryDialog must be used inside InventoryDialogProvider')
  return v
}

/** The Inventory dialog, or null outside the provider. */
export function useInventoryDialogOptional(): InventoryDialogContextValue | null {
  return useContext(InventoryDialogCtx)
}
