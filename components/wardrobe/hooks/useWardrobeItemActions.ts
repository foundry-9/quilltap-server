'use client'

/**
 * Row actions for a wardrobe list — star, archive, draw a picture, delete,
 * duplicate — plus the open/closed state of the overlays they summon (the
 * item editor, the move/copy dialog, the full-screen picture).
 *
 * Every item is addressed through `containerForListedItem` when the browsed
 * wardrobe is a character's merged view (so a borrowed group or project item
 * is addressed through its own wardrobe, never through General), and through
 * the browsed container otherwise. Writes go through one `useMutation` whose
 * success invalidates `queryKeys.wardrobe.lists` (and, in chat, the chat's
 * outfit), so every list showing the item refreshes.
 *
 * @module components/wardrobe/hooks/useWardrobeItemActions
 */

import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { fetchJson } from '@/lib/fetch-helpers'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import { nextCopyTitle } from '@/lib/wardrobe/next-copy-title'
import { draftFromItem, draftToPayload } from '@/lib/wardrobe/item-draft'
import { generateWardrobeItemImage } from '@/lib/wardrobe/item-images-client'
import {
  containerForListedItem,
  wardrobeCollectionUrl,
  wardrobeItemUrl,
  type ListedWardrobeItem,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'

export type EditorRequest =
  | { kind: 'edit'; item: WardrobeItem }
  | { kind: 'create'; mode: 'single' | 'bundle'; componentItemIds: string[] }

export interface TransferRequest {
  item: ListedWardrobeItem
  mode: 'move' | 'copy'
}

export interface ImageViewRequest {
  item: ListedWardrobeItem
  container: WardrobeContainer
}

export interface UseWardrobeItemActionsOptions {
  /** The wardrobe being browsed (null while nothing is selected). */
  container: WardrobeContainer | null
  /** Chat context, so a mutation can refresh what its characters wear. */
  chatId: string | null
  /** The list on display — Duplicate picks a title not already in it. */
  listItems: readonly WardrobeItem[]
  requestConfirmation: (message: string) => Promise<boolean>
}

interface ItemRequest {
  url: string
  method: 'POST' | 'PUT' | 'DELETE'
  body?: unknown
}

export function useWardrobeItemActions({
  container,
  chatId,
  listItems,
  requestConfirmation,
}: UseWardrobeItemActionsOptions) {
  const queryClient = useQueryClient()
  const isCharacterScope = container?.scope === 'character'

  const [editor, setEditor] = useState<EditorRequest | null>(null)
  const [transfer, setTransfer] = useState<TransferRequest | null>(null)
  const [imageView, setImageView] = useState<ImageViewRequest | null>(null)
  const [updatingDefaultId, setUpdatingDefaultId] = useState<string | null>(null)
  // Every item whose picture is being drawn right now. A set, not one id: two
  // rows may each have a commission out.
  const [generatingImageIds, setGeneratingImageIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  /** Re-read every wardrobe list, and in chat the worn snapshot. */
  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.wardrobe.lists }),
      chatId
        ? queryClient.invalidateQueries({ queryKey: queryKeys.wardrobe.outfit(chatId) })
        : Promise.resolve(),
    ])
  }, [queryClient, chatId])

  const mutation = useMutation({
    mutationFn: async ({ url, method, body }: ItemRequest) => {
      const result = await fetchJson<{ wardrobeItem?: WardrobeItem }>(url, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      })
      if (!result.ok) throw new Error(result.error || 'The wardrobe would not oblige')
      return result.data
    },
    onSuccess: () => refresh(),
  })
  const { mutateAsync } = mutation

  /** Run one item request; toast and resolve false on failure. */
  const send = useCallback(
    async (request: ItemRequest, failure: string): Promise<boolean> => {
      try {
        await mutateAsync(request)
        return true
      } catch (error) {
        showErrorToast(error instanceof Error && error.message ? error.message : failure)
        return false
      }
    },
    [mutateAsync],
  )

  /** The container an item's routes live under, from this view. */
  const addressOf = useCallback(
    (item: ListedWardrobeItem): WardrobeContainer | null =>
      isCharacterScope ? containerForListedItem(item) : container,
    [isCharacterScope, container],
  )

  const toggleDefault = useCallback(
    async (item: WardrobeItem) => {
      const home = addressOf(item)
      if (!home) return
      setUpdatingDefaultId(item.id)
      try {
        await send(
          { url: wardrobeItemUrl(home, item.id), method: 'PUT', body: { isDefault: !item.isDefault } },
          'Failed to update item',
        )
      } finally {
        setUpdatingDefaultId(null)
      }
    },
    [addressOf, send],
  )

  /**
   * Archive or restore one garment. Archiving hides it from the pickers and
   * the outfit-selection LLM's candidates; it does NOT strip it off anyone
   * already wearing it, and nobody may put it back on until it is restored.
   */
  const toggleArchived = useCallback(
    async (item: WardrobeItem) => {
      const home = addressOf(item)
      if (!home) return
      await send(
        { url: wardrobeItemUrl(home, item.id), method: 'PUT', body: { archived: !item.archivedAt } },
        'Failed to update item',
      )
    },
    [addressOf, send],
  )

  const remove = useCallback(
    async (item: WardrobeItem) => {
      const home = addressOf(item)
      if (!home) return
      if (!(await requestConfirmation(`Delete "${item.title}"? This cannot be undone.`))) return
      if (await send({ url: wardrobeItemUrl(home, item.id), method: 'DELETE' }, 'Failed to delete item')) {
        showSuccessToast(`Deleted "${item.title}"`)
      }
    },
    [addressOf, send, requestConfirmation],
  )

  /**
   * Duplicate is offered only for manageable items, so the copy stays where
   * the original lives. Composite references are copied verbatim — member
   * items are not cloned.
   */
  const duplicate = useCallback(
    async (item: WardrobeItem) => {
      const home = addressOf(item)
      if (!home) return
      const title = nextCopyTitle(
        item.title,
        listItems.map((i) => i.title),
      )
      console.debug('[useWardrobeItemActions] Duplicating wardrobe item', {
        sourceId: item.id,
        targetScope: home.scope,
        targetId: home.id,
        newTitle: title,
        componentItemIds: item.componentItemIds,
      })
      const body = draftToPayload({ ...draftFromItem(item), title })
      if (await send({ url: wardrobeCollectionUrl(home), method: 'POST', body }, 'Failed to duplicate item')) {
        showSuccessToast(`Duplicated "${item.title}"`)
      }
    },
    [addressOf, listItems, send],
  )

  /** Draw a picture with the designated wardrobe profile (no picker — the editor has that). */
  const generateImage = useCallback(
    async (item: WardrobeItem) => {
      const home = addressOf(item)
      if (!home || generatingImageIds.has(item.id)) return
      setGeneratingImageIds((prev) => new Set(prev).add(item.id))
      try {
        const result = await generateWardrobeItemImage(item.id, home)
        showSuccessToast(
          result.rerouted
            ? `A portrait of "${item.title}" is hung — drawn at the uncensored desk`
            : `A portrait of "${item.title}" is hung`,
        )
        void queryClient.invalidateQueries({ queryKey: queryKeys.wardrobe.images(item.id) })
        await refresh()
      } catch (error) {
        showErrorToast(error instanceof Error ? error.message : 'Failed to generate a picture')
      } finally {
        setGeneratingImageIds((prev) => {
          const next = new Set(prev)
          next.delete(item.id)
          return next
        })
      }
    },
    [addressOf, generatingImageIds, queryClient, refresh],
  )

  /** Open a row's current picture full screen, addressed through the wardrobe it hangs in. */
  const openImage = useCallback(
    (item: ListedWardrobeItem) => {
      const home = addressOf(item)
      if (!home || !item.imageFileId) return
      setImageView({ item, container: home })
    },
    [addressOf],
  )

  const openEditor = useCallback((item: WardrobeItem) => setEditor({ kind: 'edit', item }), [])
  const openCreate = useCallback(
    (mode: 'single' | 'bundle', componentItemIds: string[] = []) =>
      setEditor({ kind: 'create', mode, componentItemIds }),
    [],
  )
  const closeEditor = useCallback(() => setEditor(null), [])
  const move = useCallback((item: ListedWardrobeItem) => setTransfer({ item, mode: 'move' }), [])
  const copy = useCallback((item: ListedWardrobeItem) => setTransfer({ item, mode: 'copy' }), [])
  const closeTransfer = useCallback(() => setTransfer(null), [])
  const closeImage = useCallback(() => setImageView(null), [])

  return {
    // overlay state
    editor,
    transfer,
    imageView,
    /** True while any of this hook's overlays is open. */
    overlayOpen: editor !== null || transfer !== null || imageView !== null,
    // row state
    updatingDefaultId,
    generatingImageIds,
    // handlers
    toggleDefault,
    toggleArchived,
    remove,
    duplicate,
    generateImage,
    openImage,
    openEditor,
    openCreate,
    closeEditor,
    move,
    copy,
    closeTransfer,
    closeImage,
    addressOf,
    refresh,
  }
}

export type WardrobeItemActions = ReturnType<typeof useWardrobeItemActions>
