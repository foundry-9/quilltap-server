'use client'

/**
 * Item Dialog Provider — the open / close context behind the global Wardrobe,
 * Inventory and Atlas dialogs, stated once and parameterised by kind.
 *
 * Each kind's dialog lives once at the layout level; any component inside the
 * authenticated layout summons it with `useItemDialog(kind).open(ctx)` (or
 * the kind-bound `useWardrobeDialog` / `useInventoryDialog` /
 * `useAtlasDialog`), passing the optional context that kind's dialog reads.
 * The kinds keep separate
 * React contexts, so opening one never touches the other.
 *
 * Mirrors the HelpChatProvider pattern.
 *
 * @module components/providers/item-dialog-provider
 */

import { createContext, useCallback, useContext, useMemo, useState, type Context, type ReactNode } from 'react'
import type { ItemKind } from '@/lib/folder-browser/item-kind'

/**
 * What `open()` may pass the Wardrobe dialog, so it can preselect a character
 * and surface chat-scoped controls when invoked from the Salon.
 */
export interface WardrobeDialogContext {
  /** Preselect this character in the dialog header dropdown. */
  characterId?: string
  /** When set, the dialog renders the "wearing now" column for this chat. */
  chatId?: string
}

/** What `open()` may pass the Inventory dialog. */
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

/** What `open()` may pass the Atlas dialog. */
export interface AtlasDialogContext {
  /** Browse this character's own Atlas. */
  characterId?: string
  /** The chat it was opened from (its project, when it has one, is browsed). */
  chatId?: string
  /** Browse this project's Atlas. */
  projectId?: string
  /** Browse this group's Atlas. */
  groupId?: string
}

/** Each kind's `open()` context. */
export interface ItemDialogContexts {
  wardrobe: WardrobeDialogContext
  inventory: InventoryDialogContext
  atlas: AtlasDialogContext
}

export interface ItemDialogContextValue<C> {
  isOpen: boolean
  context: C | null
  open: (ctx?: C) => void
  close: () => void
}

type ItemDialogCtx<K extends ItemKind> = Context<ItemDialogContextValue<ItemDialogContexts[K]> | null>

const CONTEXTS: { [K in ItemKind]: ItemDialogCtx<K> } = {
  wardrobe: createContext<ItemDialogContextValue<WardrobeDialogContext> | null>(null),
  inventory: createContext<ItemDialogContextValue<InventoryDialogContext> | null>(null),
  atlas: createContext<ItemDialogContextValue<AtlasDialogContext> | null>(null),
}

/** The names the hooks' misuse errors use. */
const NAMES: Record<ItemKind, { hook: string; provider: string }> = {
  wardrobe: { hook: 'useWardrobeDialog', provider: 'WardrobeDialogProvider' },
  inventory: { hook: 'useInventoryDialog', provider: 'InventoryDialogProvider' },
  atlas: { hook: 'useAtlasDialog', provider: 'AtlasDialogProvider' },
}

export function ItemDialogProvider<K extends ItemKind>({ kind, children }: { kind: K; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [context, setContext] = useState<ItemDialogContexts[K] | null>(null)

  const open = useCallback((ctx?: ItemDialogContexts[K]) => {
    setContext(ctx ?? null)
    setIsOpen(true)
  }, [])
  const close = useCallback(() => setIsOpen(false), [])
  const value = useMemo(() => ({ isOpen, context, open, close }), [isOpen, context, open, close])

  const Ctx = CONTEXTS[kind] as ItemDialogCtx<K>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** One kind's dialog, or null outside its provider. */
export function useItemDialogOptional<K extends ItemKind>(kind: K): ItemDialogContextValue<ItemDialogContexts[K]> | null {
  return useContext(CONTEXTS[kind] as ItemDialogCtx<K>)
}

/** One kind's dialog. Throws outside its provider. */
export function useItemDialog<K extends ItemKind>(kind: K): ItemDialogContextValue<ItemDialogContexts[K]> {
  const value = useItemDialogOptional(kind)
  if (!value) throw new Error(`${NAMES[kind].hook} must be used inside ${NAMES[kind].provider}`)
  return value
}
