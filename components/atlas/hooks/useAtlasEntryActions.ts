'use client'

/**
 * The Atlas browser's row actions and the overlays they open: the editor,
 * the folder picker, the cross-tier transfer and a row's picture full screen
 * (the shared `useItemOverlays`), plus archive, duplicate and delete. Every confirmation
 * goes through `requestConfirmation` so the dialog that hosts the browser can
 * keep itself open while one is up.
 *
 * @module components/atlas/hooks/useAtlasEntryActions
 */

import { useCallback, useMemo, useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { AtlasEntryWithOrigin } from '@/lib/schemas/atlas.types'
import type { AtlasLoreDraft } from '@/lib/atlas/lore-draft/request-schema'
import { GENERAL_ATLAS_CONTAINER, containerOfAtlasOrigin, type AtlasContainer } from '@/lib/atlas/container'
import { AtlasRequestError, useAtlasMutations } from '@/lib/hooks/use-atlas'
import { useItemOverlays } from '@/components/item-browser/useItemOverlays'

export type AtlasEditorState =
  /** `draft`: a new entry prefilled from the lore wizard. */
  | { kind: 'create'; folder: string; draft?: AtlasLoreDraft }
  | { kind: 'edit'; entry: AtlasEntryWithOrigin }

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
  /** The lore wizard, open on the folder a drafted entry will be filed in. */
  const [loreWizard, setLoreWizard] = useState<{ folder: string } | null>(null)
  const overlays = useItemOverlays<AtlasEntryWithOrigin, AtlasEditorState>(loreWizard !== null)
  const { openEditorWith, openImageView } = overlays

  /** The tier an entry lives in. */
  const addressOf = useCallback(
    (entry: AtlasEntryWithOrigin): AtlasContainer => containerOfAtlasOrigin(entry.origin, container ?? GENERAL_ATLAS_CONTAINER),
    [container],
  )

  /** Open a row's current picture full screen. */
  const openImage = useCallback(
    (entry: AtlasEntryWithOrigin) => {
      if (entry.imageFileId) openImageView({ item: entry, container: addressOf(entry) })
    },
    [addressOf, openImageView],
  )

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

  return useMemo(
    () => ({
      ...overlays,
      openImage,
      mutations,
      addressOf,
      requestConfirmation,
      requestAlert,
      openCreate: (folder = '') => openEditorWith({ kind: 'create', folder }),
      loreWizard,
      openLoreWizard: (folder = '') => setLoreWizard({ folder }),
      closeLoreWizard: () => setLoreWizard(null),
      /** The wizard's draft goes to the editor in create mode; the wizard closes. */
      openCreateFromDraft: (draft: AtlasLoreDraft) => {
        const folder = loreWizard?.folder ?? ''
        setLoreWizard(null)
        openEditorWith({ kind: 'create', folder, draft })
      },
      openEditor: (entry: AtlasEntryWithOrigin) => openEditorWith({ kind: 'edit', entry }),
      remove,
      toggleArchived,
      duplicate,
    }),
    [overlays, loreWizard, openImage, openEditorWith, mutations, addressOf, requestConfirmation, requestAlert, remove, toggleArchived, duplicate],
  )
}

export type AtlasEntryActions = ReturnType<typeof useAtlasEntryActions>
