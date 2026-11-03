'use client'

/**
 * Row actions for a wardrobe list — star, archive, draw a picture, delete,
 * duplicate (into the same folder) — plus the open/closed state of the overlays they summon (the
 * item editor, the move/copy dialog and the move/copy-to-folder picker from the shared
 * `useItemOverlays`; the full-screen picture here).
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
import { useItemOverlays } from '@/components/item-browser/useItemOverlays'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { fetchJson } from '@/lib/fetch-helpers'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import { generateWardrobeItemImage } from '@/lib/wardrobe/item-images-client'
import {
  containerForListedItem,
  wardrobeCollectionActionUrl,
  wardrobeItemUrl,
  type ListedWardrobeItem,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'

export type EditorRequest =
  | { kind: 'edit'; item: WardrobeItem }
  | {
      kind: 'create'
      mode: 'single' | 'bundle'
      componentItemIds: string[]
      /** The folder being browsed — where the editor files the new item by default. */
      folder?: string
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
  requestConfirmation,
}: UseWardrobeItemActionsOptions) {
  const queryClient = useQueryClient()
  const isCharacterScope = container?.scope === 'character'

  const [imageView, setImageView] = useState<ImageViewRequest | null>(null)
  // The editor, the folder picker and the transfer dialog; the picture viewer
  // is the wardrobe's own overlay.
  const overlays = useItemOverlays<ListedWardrobeItem, EditorRequest>(imageView !== null)
  const { openEditorWith, openTransfer } = overlays
  const [updatingDefaultId, setUpdatingDefaultId] = useState<string | null>(null)
  // Every item whose picture is being drawn right now. A set, not one id: two
  // rows may each have a commission out.
  const [generatingImageIds, setGeneratingImageIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  /**
   * Re-read every wardrobe list and folder tree (an item's folder may be new),
   * and in chat the worn snapshot.
   */
  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.wardrobe.lists }),
      queryClient.invalidateQueries({ queryKey: queryKeys.wardrobe.folderLists }),
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
   * the original lives. The server's `?action=duplicate` picks the "(copy)"
   * title and copies composite references verbatim — member items are not
   * cloned.
   */
  const duplicate = useCallback(
    async (item: WardrobeItem) => {
      const home = addressOf(item)
      if (!home) return
      const body = { itemId: item.id }
      if (await send({ url: wardrobeCollectionActionUrl(home, 'duplicate'), method: 'POST', body }, 'Failed to duplicate item')) {
        showSuccessToast(`Duplicated "${item.title}"`)
      }
    },
    [addressOf, send],
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

  const openEditor = useCallback((item: WardrobeItem) => openEditorWith({ kind: 'edit', item }), [openEditorWith])
  const openCreate = useCallback(
    (mode: 'single' | 'bundle', componentItemIds: string[] = [], opts?: { folder?: string }) =>
      openEditorWith({ kind: 'create', mode, componentItemIds, folder: opts?.folder }),
    [openEditorWith],
  )
  const move = useCallback((item: ListedWardrobeItem) => openTransfer(item, 'move'), [openTransfer])
  const copy = useCallback((item: ListedWardrobeItem) => openTransfer(item, 'copy'), [openTransfer])
  const closeImage = useCallback(() => setImageView(null), [])

  return {
    // overlay state: editor, folderPicker, transfer, overlayOpen and their
    // open / close handlers
    ...overlays,
    imageView,
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
    move,
    copy,
    closeImage,
    addressOf,
    refresh,
    /** Ask the operator to confirm (the folder delete uses it too). */
    confirm: requestConfirmation,
  }
}

export type WardrobeItemActions = ReturnType<typeof useWardrobeItemActions>
