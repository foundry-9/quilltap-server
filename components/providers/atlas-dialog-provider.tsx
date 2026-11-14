'use client'

/**
 * Atlas Dialog Provider — the Atlas-bound face of `ItemDialogProvider`
 * (`components/providers/item-dialog-provider.tsx`).
 *
 * Hosts the global Atlas dialog's open state. Any component in the
 * authenticated layout can summon it with `useAtlasDialog().open()`, passing
 * an optional character, group or project to browse, or the chat it was
 * opened from (with that chat's project, when it has one).
 *
 * @module components/providers/atlas-dialog-provider
 */

import type { ReactNode } from 'react'
import {
  ItemDialogProvider,
  useItemDialog,
  useItemDialogOptional,
  type AtlasDialogContext,
  type ItemDialogContextValue,
} from './item-dialog-provider'

export type { AtlasDialogContext } from './item-dialog-provider'

export function AtlasDialogProvider({ children }: { children: ReactNode }) {
  return <ItemDialogProvider kind="atlas">{children}</ItemDialogProvider>
}

/** The Atlas dialog. Throws outside the provider. */
export function useAtlasDialog(): ItemDialogContextValue<AtlasDialogContext> {
  return useItemDialog('atlas')
}

/** The Atlas dialog, or null outside the provider. */
export function useAtlasDialogOptional(): ItemDialogContextValue<AtlasDialogContext> | null {
  return useItemDialogOptional('atlas')
}
