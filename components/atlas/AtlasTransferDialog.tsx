'use client'

/**
 * Move or copy one Atlas entry to another tier — a character's vault, a
 * group's or project's store, or Quilltap General. A move keeps the entry's
 * id; a copy is a new entry. The folder path and the pictures come along.
 * The dialog's chrome is the shared `ItemTransferDialog`.
 *
 * @module components/atlas/AtlasTransferDialog
 */

import type { AtlasEntryWithOrigin } from '@/lib/schemas/atlas.types'
import { GENERAL_ATLAS_NAME, type AtlasContainer } from '@/lib/atlas/container'
import type { ContainerCatalogue } from '@/lib/hooks/use-container-catalogue'
import { ItemTransferDialog } from '@/components/item-browser/ItemTransferDialog'
import type { AtlasEntryActions } from './hooks/useAtlasEntryActions'
import { describeAtlasRefusal } from './hooks/useAtlasEntryActions'

/** Where an entry can go: the shared container catalogue's three lists. */
export type AtlasCatalogue = Pick<ContainerCatalogue, 'characters' | 'projects' | 'groups'>

interface AtlasTransferDialogProps {
  entry: AtlasEntryWithOrigin
  mode: 'move' | 'copy'
  from: AtlasContainer
  catalogue: AtlasCatalogue
  actions: AtlasEntryActions
  onClose: () => void
}

export function AtlasTransferDialog({ entry, mode, from, catalogue, actions, onClose }: AtlasTransferDialogProps) {
  return (
    <ItemTransferDialog
      mode={mode}
      from={from}
      catalogue={catalogue}
      wording={{
        title: (verb) => `${verb} "${entry.name}" to another atlas`,
        selectId: 'atlas-transfer-target',
        generalName: GENERAL_ATLAS_NAME,
        placeholder: 'Choose an atlas',
        done: (m) => (m === 'move' ? `"${entry.name}" has been re-charted` : `A fair copy of "${entry.name}" is on its way`),
        describeError: describeAtlasRefusal,
        failed: (m) => `The entry would not ${m}`,
      }}
      note={
        mode === 'move'
          ? 'The entry keeps its identity and its pictures; its folder comes along. Whoever can reach the destination is told of it from now on.'
          : 'The copy is a new entry with its own identity and copies of the pictures, filed in the same folder at the destination.'
      }
      transfer={(to) => actions.mutations.transfer({ action: mode, entryId: entry.id, from, to })}
      onClose={onClose}
    />
  )
}
