'use client'

/**
 * Wardrobe Dialog Provider — the Wardrobe-bound face of `ItemDialogProvider`
 * (`components/providers/item-dialog-provider.tsx`).
 *
 * Hosts the global "Wardrobe Control" dialog's open state. Any component
 * inside the authenticated layout can summon the dialog via
 * `useWardrobeDialog().open()`, passing optional `characterId` / `chatId`
 * context — from the left sidebar, the participant cards, the Aurora
 * character page, etc.
 *
 * @module components/providers/wardrobe-dialog-provider
 */

import type { ReactNode } from 'react'
import {
  ItemDialogProvider,
  useItemDialog,
  useItemDialogOptional,
  type ItemDialogContextValue,
  type WardrobeDialogContext,
} from './item-dialog-provider'

export type { WardrobeDialogContext } from './item-dialog-provider'

export function WardrobeDialogProvider({ children }: { children: ReactNode }) {
  return <ItemDialogProvider kind="wardrobe">{children}</ItemDialogProvider>
}

/** The wardrobe dialog. Throws if used outside the provider. */
export function useWardrobeDialog(): ItemDialogContextValue<WardrobeDialogContext> {
  return useItemDialog('wardrobe')
}

/**
 * Optional variant for components that may render outside the provider tree
 * (e.g. unauthenticated pages). Returns null instead of throwing.
 */
export function useWardrobeDialogOptional(): ItemDialogContextValue<WardrobeDialogContext> | null {
  return useItemDialogOptional('wardrobe')
}
