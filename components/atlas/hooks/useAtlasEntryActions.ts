'use client'

/**
 * The Atlas browser's row actions and the overlays they open: the editor,
 * the folder picker and the cross-tier transfer (the shared
 * `useItemOverlays`), a row's picture full screen, plus archive, duplicate and delete. Every confirmation
 * goes through `requestConfirmation` so the dialog that hosts the browser can
 * keep itself open while one is up.
 *
 * @module components/atlas/hooks/useAtlasEntryActions
 */

import { useCallback, useMemo, useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { AtlasEntryWithOrigin } from '@/lib/schemas/atlas.types'
import { GENERAL_ATLAS_CONTAINER, containerOfAtlasOrigin, type AtlasContainer } from '@/lib/atlas/container'
import { AtlasRequestError, useAtlasMutations } from '@/lib/hooks/use-atlas'
import { useItemOverlays } from '@/components/item-browser/useItemOverlays'

export type AtlasEditorState =
  | { kind: 'create'; folder: string }
  | { kind: 'edit'; entry: AtlasEntryWithOrigin }

/** A row's current picture on show, addressed through the tier it lives in. */
export interface AtlasImageView {
  entry: AtlasEntryWithOrigin
  container: AtlasContainer
}

export interface AtlasEntryActionsOptions {
  /** The tier being browsed. */
  container: AtlasContainer | null
  requestConfirmation: (message: string) => Promise<boolean>
  requestAlert: (message: string, buttons?: string[]) => Promise<string | undefined>
}

/** The words for a refusal the server answered with a code. */
export function describeAtlasRefusal(error: unknown, fallback: string): string {
  if (error instanceof AtlasRequestError) {
    if (error.code === 'NAME_TAKEN') {
      const name = typeof error.details.name === 'string' ? error.details.name : 'that name'
      return `An entry called "${name}" is already filed in this atlas. Choose another name, or give the newcomer the name as an alias instead.`
    }
    return error.message
  }
  return error instanceof Error ? error.message : fallback
}

export function useAtlasEntryActions({ container, requestConfirmation, requestAlert }: AtlasEntryActionsOptions) {
  const mutations = useAtlasMutations()
  const [imageView, setImageView] = useState<AtlasImageView | null>(null)
  const overlays = useItemOverlays<AtlasEntryWithOrigin, AtlasEditorState>(imageView !== null)

  /** The tier an entry lives in. */
  const addressOf = useCallback(
    (entry: AtlasEntryWithOrigin): AtlasContainer => containerOfAtlasOrigin(entry.origin, container ?? GENERAL_ATLAS_CONTAINER),
    [container],
  )

  /** Open a row's current picture full screen. */
  const openImage = useCallback(
    (entry: AtlasEntryWithOrigin) => {
      if (entry.imageFileId) setImageView({ entry, container: addressOf(entry) })
    },
    [addressOf],
  )
  const closeImage = useCallback(() => setImageView(null), [])

  const remove = useCallback(
    async (entry: AtlasEntryWithOrigin) => {
      try {
        if (!(await requestConfirmation(`Strike "${entry.name}" from the Atlas? Its pictures go with it, and nobody will be told of it again.`))) return
        await mutations.remove(addressOf(entry), entry.id)
        showSuccessToast(`"${entry.name}" has been struck from the Atlas`)
      } catch (error) {
        showErrorToast(describeAtlasRefusal(error, 'The entry would not be deleted'))
      }
    },
    [requestConfirmation, mutations, addressOf],
  )

  const toggleArchived = useCallback(
    async (entry: AtlasEntryWithOrigin) => {
      try {
        await mutations.update(addressOf(entry), entry.id, { archived: !entry.archivedAt })
        showSuccessToast(entry.archivedAt ? `"${entry.name}" is back on the map` : `"${entry.name}" is folded away`)
      } catch (error) {
        showErrorToast(describeAtlasRefusal(error, 'The entry would not change'))
      }
    },
    [mutations, addressOf],
  )

  const duplicate = useCallback(
    async (entry: AtlasEntryWithOrigin) => {
      try {
        const copy = await mutations.duplicate(addressOf(entry), entry.id)
        showSuccessToast(`"${copy.name}" is inked beside the original`)
      } catch (error) {
        showErrorToast(describeAtlasRefusal(error, 'The entry would not be duplicated'))
      }
    },
    [mutations, addressOf],
  )

  const { openEditorWith } = overlays
  return useMemo(
    () => ({
      ...overlays,
      imageView,
      openImage,
      closeImage,
      mutations,
      addressOf,
      requestConfirmation,
      requestAlert,
      openCreate: (folder = '') => openEditorWith({ kind: 'create', folder }),
      openEditor: (entry: AtlasEntryWithOrigin) => openEditorWith({ kind: 'edit', entry }),
      remove,
      toggleArchived,
      duplicate,
    }),
    [overlays, imageView, openImage, closeImage, openEditorWith, mutations, addressOf, requestConfirmation, requestAlert, remove, toggleArchived, duplicate],
  )
}

export type AtlasEntryActions = ReturnType<typeof useAtlasEntryActions>
