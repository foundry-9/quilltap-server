'use client'

/**
 * Inventory Dialog Provider — the Inventory-bound face of `ItemDialogProvider`
 * (`components/providers/item-dialog-provider.tsx`).
 *
 * Hosts the global Inventory dialog's (Pascal the Croupier's) open state. Any
 * component in the authenticated layout can summon it with
 * `useInventoryDialog().open()`, passing an optional character to preselect,
 * a chat (which adds the equip controls and the *Carrying now* pane) or a
 * project or group to browse.
 *
 * @module components/providers/inventory-dialog-provider
 */

import type { ReactNode } from 'react'
import {
  ItemDialogProvider,
  useItemDialog,
  useItemDialogOptional,
  type InventoryDialogContext,
  type ItemDialogContextValue,
} from './item-dialog-provider'

export type { InventoryDialogContext } from './item-dialog-provider'

export function InventoryDialogProvider({ children }: { children: ReactNode }) {
  return <ItemDialogProvider kind="inventory">{children}</ItemDialogProvider>
}

/** The Inventory dialog. Throws outside the provider. */
export function useInventoryDialog(): ItemDialogContextValue<InventoryDialogContext> {
  return useItemDialog('inventory')
}

/** The Inventory dialog, or null outside the provider. */
export function useInventoryDialogOptional(): ItemDialogContextValue<InventoryDialogContext> | null {
  return useItemDialogOptional('inventory')
}
