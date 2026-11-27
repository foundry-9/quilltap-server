'use client'

/**
 * The "Move / Copy to another tier" dialog of the Inventory and the Atlas:
 * a note on what travels, a destination `ContainerSelect` that leaves out the
 * item's own home, and the shared `ItemTransferFooter`. What the transfer
 * sends, and the words around it, stay each kind's own — the transfer
 * services differ on purpose; only the chrome is shared here.
 *
 * The wardrobe keeps its own dialog (`WardrobeTransferDialog`): its outfit
 * components, default destination and probed source have no place here.
 *
 * @module components/item-browser/ItemTransferDialog
 */

import { useState, type ReactNode } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import {
  decodeWardrobeContainer,
  encodeWardrobeContainer,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'
import type { ContainerCatalogue } from '@/lib/hooks/use-container-catalogue'
import { ContainerSelect } from './ContainerSelect'
import { ItemTransferFooter } from './ItemTransferFooter'

/** The words of one kind's transfer dialog. */
export interface ItemTransferWording {
  /** The dialog title, given `Move` / `Copy`. */
  title: (verb: 'Move' | 'Copy') => string
  /** The `id` of the destination select (its label points at it). */
  selectId: string
  /** The General option's name. */
  generalName: string
  /** The select's placeholder, e.g. `Choose an atlas`. */
  placeholder: string
  /** The success toast. */
  done: (mode: 'move' | 'copy') => string
  /** The failure toast, given the error. */
  describeError: (error: unknown, fallback: string) => string
  /** The failure fallback, given the mode. */
  failed: (mode: 'move' | 'copy') => string
}

export interface ItemTransferDialogProps {
  mode: 'move' | 'copy'
  /** The item's home tier, left out of the destinations. */
  from: WardrobeContainer
  catalogue: Pick<ContainerCatalogue, 'characters' | 'projects' | 'groups'>
  wording: ItemTransferWording
  /** The note above the select. */
  note: ReactNode
  /** Send the transfer; throws on refusal. */
  transfer: (to: WardrobeContainer) => Promise<unknown>
  onClose: () => void
}

export function ItemTransferDialog({ mode, from, catalogue, wording, note, transfer, onClose }: ItemTransferDialogProps) {
  const fromKey = encodeWardrobeContainer(from)
  const [target, setTarget] = useState('')
  const [working, setWorking] = useState(false)
  const verb = mode === 'move' ? 'Move' : 'Copy'

  const submit = async () => {
    const to = decodeWardrobeContainer(target)
    if (!to) return
    setWorking(true)
    try {
      await transfer(to)
      showSuccessToast(wording.done(mode))
      onClose()
    } catch (error) {
      showErrorToast(wording.describeError(error, wording.failed(mode)))
    } finally {
      setWorking(false)
    }
  }

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={wording.title(verb)}
      maxWidth="md"
      closeOnClickOutside={!working}
      footer={(
        <ItemTransferFooter mode={mode} working={working} submitDisabled={!target} onCancel={onClose} onSubmit={() => void submit()} />
      )}
    >
      <p className="qt-text-xs qt-text-secondary mb-2">{note}</p>
      <label className="text-sm qt-text" htmlFor={wording.selectId}>Destination</label>
      <ContainerSelect
        id={wording.selectId}
        className="qt-select w-full mt-1"
        value={target}
        onChange={setTarget}
        catalogue={catalogue}
        generalName={wording.generalName}
        placeholder={wording.placeholder}
        exclude={[fromKey]}
      />
    </BaseModal>
  )
}
