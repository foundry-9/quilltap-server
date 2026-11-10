'use client'

/**
 * Move or copy one Atlas entry to another tier — a character's vault, a
 * group's or project's store, or Quilltap General. A move keeps the entry's
 * id; a copy is a new entry. The folder path and the pictures come along.
 *
 * @module components/atlas/AtlasTransferDialog
 */

import { useState } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { AtlasEntryWithOrigin } from '@/lib/schemas/atlas.types'
import {
  GENERAL_ATLAS_NAME,
  decodeAtlasContainer,
  encodeAtlasContainer,
  type AtlasContainer,
} from '@/lib/atlas/container'
import type { ContainerCatalogue } from '@/lib/hooks/use-container-catalogue'
import { ContainerSelect } from '@/components/item-browser/ContainerSelect'
import { ItemTransferFooter } from '@/components/item-browser/ItemTransferFooter'
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
  const fromKey = encodeAtlasContainer(from)
  const [target, setTarget] = useState('')
  const [working, setWorking] = useState(false)
  const verb = mode === 'move' ? 'Move' : 'Copy'

  const submit = async () => {
    const to = decodeAtlasContainer(target)
    if (!to) return
    setWorking(true)
    try {
      await actions.mutations.transfer({ action: mode, entryId: entry.id, from, to })
      showSuccessToast(mode === 'move' ? `"${entry.name}" has been re-charted` : `A fair copy of "${entry.name}" is on its way`)
      onClose()
    } catch (error) {
      showErrorToast(describeAtlasRefusal(error, `The entry would not ${mode}`))
    } finally {
      setWorking(false)
    }
  }

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={`${verb} "${entry.name}" to another atlas`}
      maxWidth="md"
      overlayClassName="z-[70]"
      closeOnClickOutside={!working}
      footer={(
        <ItemTransferFooter mode={mode} working={working} submitDisabled={!target} onCancel={onClose} onSubmit={() => void submit()} />
      )}
    >
      <p className="qt-text-xs qt-text-secondary mb-2">
        {mode === 'move'
          ? 'The entry keeps its identity and its pictures; its folder comes along. Whoever can reach the destination is told of it from now on.'
          : 'The copy is a new entry with its own identity and copies of the pictures, filed in the same folder at the destination.'}
      </p>
      <label className="text-sm text-foreground" htmlFor="atlas-transfer-target">Destination</label>
      <ContainerSelect
        id="atlas-transfer-target"
        className="qt-select w-full mt-1"
        value={target}
        onChange={setTarget}
        catalogue={catalogue}
        generalName={GENERAL_ATLAS_NAME}
        placeholder="Choose an atlas"
        exclude={[fromKey]}
      />
    </BaseModal>
  )
}
