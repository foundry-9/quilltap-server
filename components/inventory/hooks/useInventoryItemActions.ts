'use client'

/**
 * The Inventory browser's row actions and the overlays they open: the
 * editor, the folder picker, the cross-tier transfer, the instantiate
 * picker and the picture viewer — plus the three warnings the spec asks for:
 *
 *   - **Detach**: "This object will stop following *Magic bow*…";
 *   - **Delete an archetype in use**: the count and the holders, with
 *     *Detach all and delete* — or, when an archived character holds one,
 *     the list of them and no way through;
 *   - **Equip over the cap**: which object and which cap.
 *
 * Every confirmation goes through `requestConfirmation` / `requestAlert` so
 * the dialog that hosts the browser can keep itself open while one is up.
 *
 * @module components/inventory/hooks/useInventoryItemActions
 */

import { useCallback, useMemo, useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import { containerOfOrigin, type InventoryContainer } from '@/lib/inventory/container'
import { InventoryRequestError, useInventoryMutations } from '@/lib/hooks/use-inventory'
import { inventoryLabel } from '@/lib/inventory/resolve'

export type InventoryEditorState =
  | { kind: 'create'; mode: 'item' | 'kit' | 'archetype'; folder: string }
  | { kind: 'edit'; item: ResolvedInventoryItem }

export interface InventoryItemActionsOptions {
  /** The tier being browsed. */
  container: InventoryContainer | null
  requestConfirmation: (message: string) => Promise<boolean>
  requestAlert: (message: string, buttons?: string[]) => Promise<string | undefined>
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The words for a refusal the server answered with a code. */
export function describeInventoryRefusal(error: unknown, fallback: string): string {
  if (error instanceof InventoryRequestError) {
    if (error.code === 'CAP_EXCEEDED') {
      const name = String(error.details.itemName ?? 'That object')
      const cap = Number(error.details.cap ?? 1)
      return `"${name}" can be carried at most ${cap} at a time — set one down before taking up another.`
    }
    if (error.code === 'NOT_COPYABLE') {
      const count = Array.isArray(error.details.itemIds) ? error.details.itemIds.length : 1
      return count === 1
        ? 'That object is one of a kind and cannot be copied — tick "Can be copied" in its editor first, or move it instead.'
        : `${count} of those objects are one of a kind and cannot be copied — tick "Can be copied" in their editors first, or move them instead.`
    }
    // The title lint's refusal is one line per collision; a toast shows it as one line.
    if (error.code === 'TITLE_SHADOW' || error.code === 'TITLE_CHECK_UNAVAILABLE') {
      return error.message.split('\n').map((line) => line.trim()).join('; ')
    }
    return error.message
  }
  return error instanceof Error ? error.message : fallback
}

export function useInventoryItemActions({ container, requestConfirmation, requestAlert }: InventoryItemActionsOptions) {
  const mutations = useInventoryMutations()
  const [editor, setEditor] = useState<InventoryEditorState | null>(null)
  const [folderPicker, setFolderPicker] = useState<{ items: ResolvedInventoryItem[] } | null>(null)
  const [transfer, setTransfer] = useState<{ item: ResolvedInventoryItem; mode: 'move' | 'copy' } | null>(null)
  const [instantiateFor, setInstantiateFor] = useState<
    { archetype: ResolvedInventoryItem } | { destination: InventoryContainer; folder: string } | null
  >(null)

  /** The tier an object lives in (a borrowed one is addressed at its own tier). */
  const addressOf = useCallback(
    (item: ResolvedInventoryItem): InventoryContainer =>
      container ? containerOfOrigin(item.origin, container) : containerOfOrigin(item.origin, { scope: 'general', id: null }),
    [container],
  )

  const detach = useCallback(
    async (item: ResolvedInventoryItem) => {
      const ok = await requestConfirmation(
        `This object will stop following "${item.parentName ?? 'its archetype'}". Its current values are kept; later edits to the archetype will not reach it.`,
      )
      if (!ok) return
      try {
        await mutations.detach(addressOf(item), item.id)
        showSuccessToast(`"${inventoryLabel(item)}" now stands on its own`)
      } catch (error) {
        showErrorToast(describeInventoryRefusal(error, 'The object would not detach'))
      }
    },
    [requestConfirmation, mutations, addressOf],
  )

  const remove = useCallback(
    async (item: ResolvedInventoryItem) => {
      const at = addressOf(item)
      const label = inventoryLabel(item)
      try {
        if (!(await requestConfirmation(`Delete "${label}"? Its pictures go with it.`))) return
        await mutations.remove(at, item.id)
        showSuccessToast(`"${label}" is gone from the table`)
      } catch (error) {
        if (!(error instanceof InventoryRequestError)) {
          showErrorToast(describeInventoryRefusal(error, 'The object would not be deleted'))
          return
        }
        if (error.code === 'ARCHIVED_DEPENDENTS') {
          const names = ((error.details.characters as Array<{ name?: string | null }> | undefined) ?? [])
            .map((c) => c.name ?? 'an archived character')
            .join(', ')
          await requestAlert(
            `"${label}" cannot be deleted while archived characters hold instances of it: ${names}. Their vaults are sealed; restore them first.`,
            ['Understood'],
          )
          return
        }
        if (error.code !== 'ARCHETYPE_IN_USE') {
          showErrorToast(describeInventoryRefusal(error, 'The object would not be deleted'))
          return
        }
        const count = Number(error.details.dependents ?? 0)
        const holders = ((error.details.holders as Array<{ ownerName?: string | null }> | undefined) ?? [])
          .map((h) => h.ownerName ?? 'somewhere')
          .join(', ')
        const choice = await requestAlert(
          `${plural(count, 'object')} ${count === 1 ? 'derives' : 'derive'} from "${label}" (held by ${holders}). Detach them all — each keeps its current values and stands on its own — and delete the archetype?`,
          ['Detach all and delete', 'Cancel'],
        )
        if (choice !== 'Detach all and delete') return
        try {
          await mutations.remove(at, item.id, true)
          showSuccessToast(`"${label}" is gone; ${plural(count, 'object')} now stand on their own`)
        } catch (forcedError) {
          if (forcedError instanceof InventoryRequestError && forcedError.code === 'ARCHIVED_DEPENDENTS') {
            const names = ((forcedError.details.characters as Array<{ name?: string | null }> | undefined) ?? [])
              .map((c) => c.name ?? 'an archived character')
              .join(', ')
            await requestAlert(
              `"${label}" cannot be deleted while archived characters hold instances of it: ${names}.`,
              ['Understood'],
            )
            return
          }
          showErrorToast(describeInventoryRefusal(forcedError, 'The archetype would not be deleted'))
        }
      }
    },
    [addressOf, requestConfirmation, requestAlert, mutations],
  )

  const toggleArchived = useCallback(
    async (item: ResolvedInventoryItem) => {
      try {
        await mutations.update(addressOf(item), item.id, { archived: !item.archivedAt })
        showSuccessToast(item.archivedAt ? `"${inventoryLabel(item)}" is back on the shelf` : `"${inventoryLabel(item)}" is put away`)
      } catch (error) {
        showErrorToast(describeInventoryRefusal(error, 'The object would not change'))
      }
    },
    [mutations, addressOf],
  )

  const duplicate = useCallback(
    async (item: ResolvedInventoryItem) => {
      try {
        const copy = await mutations.duplicate(addressOf(item), item.id)
        showSuccessToast(`"${inventoryLabel(copy)}" is laid beside the original`)
      } catch (error) {
        showErrorToast(describeInventoryRefusal(error, 'The object would not be duplicated'))
      }
    },
    [mutations, addressOf],
  )

  const overlayOpen = editor !== null || folderPicker !== null || transfer !== null || instantiateFor !== null

  return useMemo(
    () => ({
      mutations,
      addressOf,
      requestConfirmation,
      requestAlert,
      overlayOpen,
      editor,
      openCreate: (mode: 'item' | 'kit' | 'archetype', folder = '') => setEditor({ kind: 'create', mode, folder }),
      openEditor: (item: ResolvedInventoryItem) => setEditor({ kind: 'edit', item }),
      closeEditor: () => setEditor(null),
      folderPicker,
      openFolderPicker: (items: ResolvedInventoryItem[]) => setFolderPicker({ items }),
      closeFolderPicker: () => setFolderPicker(null),
      transfer,
      openTransfer: (item: ResolvedInventoryItem, mode: 'move' | 'copy') => setTransfer({ item, mode }),
      closeTransfer: () => setTransfer(null),
      instantiateFor,
      openInstantiateArchetype: (archetype: ResolvedInventoryItem) => setInstantiateFor({ archetype }),
      openInstantiateInto: (destination: InventoryContainer, folder: string) => setInstantiateFor({ destination, folder }),
      closeInstantiate: () => setInstantiateFor(null),
      detach,
      remove,
      toggleArchived,
      duplicate,
    }),
    [mutations, addressOf, requestConfirmation, requestAlert, overlayOpen, editor, folderPicker, transfer, instantiateFor, detach, remove, toggleArchived, duplicate],
  )
}

export type InventoryItemActions = ReturnType<typeof useInventoryItemActions>
