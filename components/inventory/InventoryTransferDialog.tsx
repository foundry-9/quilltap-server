'use client'

/**
 * Move or copy one Inventory object to another tier — a character's vault, a
 * group's or project's store, or Quilltap General. A move keeps the object's
 * id (so every chat that carries it, and every kit that names it, still
 * does); a copy is a new object and is offered only when the object can be
 * copied. The folder path comes along.
 *
 * @module components/inventory/InventoryTransferDialog
 */

import { useState } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import {
  GENERAL_INVENTORY_CONTAINER,
  GENERAL_INVENTORY_NAME,
  decodeInventoryContainer,
  encodeInventoryContainer,
  type InventoryContainer,
} from '@/lib/inventory/container'
import type { InventoryItemActions } from './hooks/useInventoryItemActions'
import { describeInventoryRefusal } from './hooks/useInventoryItemActions'

export interface InventoryCatalogue {
  characters: Array<{ id: string; name: string }>
  projects: Array<{ id: string; name: string }>
  groups: Array<{ id: string; name: string }>
}

interface InventoryTransferDialogProps {
  item: ResolvedInventoryItem
  mode: 'move' | 'copy'
  from: InventoryContainer
  catalogue: InventoryCatalogue
  actions: InventoryItemActions
  onClose: () => void
}

export function InventoryTransferDialog({ item, mode, from, catalogue, actions, onClose }: InventoryTransferDialogProps) {
  const fromKey = encodeInventoryContainer(from)
  const [target, setTarget] = useState('')
  const [working, setWorking] = useState(false)
  const verb = mode === 'move' ? 'Move' : 'Copy'
  const label = item.title || item.name

  const option = (container: InventoryContainer, name: string) => {
    const value = encodeInventoryContainer(container)
    return value === fromKey ? null : (
      <option key={value} value={value}>{name}</option>
    )
  }

  const submit = async () => {
    const to = decodeInventoryContainer(target)
    if (!to) return
    setWorking(true)
    try {
      await actions.mutations.transfer({ action: mode, itemId: item.id, from, to })
      showSuccessToast(mode === 'move' ? `"${label}" has changed hands` : `A copy of "${label}" is on its way`)
      onClose()
    } catch (error) {
      showErrorToast(describeInventoryRefusal(error, `The object would not ${mode}`))
    } finally {
      setWorking(false)
    }
  }

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={`${verb} "${label}" to another inventory`}
      maxWidth="md"
      overlayClassName="z-[70]"
      closeOnClickOutside={!working}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className="qt-button-secondary qt-button-sm" onClick={onClose} disabled={working}>Cancel</button>
          <button type="button" className="qt-button-primary qt-button-sm" onClick={() => void submit()} disabled={!target || working}>
            {working ? `${verb === 'Move' ? 'Moving' : 'Copying'}…` : verb}
          </button>
        </div>
      )}
    >
      <p className="qt-text-xs qt-text-secondary mb-2">
        {mode === 'move'
          ? 'The object keeps its identity: chats that carry it, and kits that name it, still do. Its folder comes along.'
          : 'The copy is a new object with its own identity, filed in the same folder at the destination.'}
        {item.parentId && ' An instance stays an instance of its archetype wherever it goes.'}
      </p>
      <label className="text-sm text-foreground" htmlFor="inventory-transfer-target">Destination</label>
      <select
        id="inventory-transfer-target"
        className="qt-select w-full mt-1"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      >
        <option value="" disabled>Choose an inventory</option>
        {catalogue.characters.length > 0 && (
          <optgroup label="Characters">
            {catalogue.characters.map((c) => option({ scope: 'character', id: c.id }, c.name))}
          </optgroup>
        )}
        <optgroup label="General">{option(GENERAL_INVENTORY_CONTAINER, GENERAL_INVENTORY_NAME)}</optgroup>
        {catalogue.projects.length > 0 && (
          <optgroup label="Projects">{catalogue.projects.map((p) => option({ scope: 'project', id: p.id }, p.name))}</optgroup>
        )}
        {catalogue.groups.length > 0 && (
          <optgroup label="Groups">{catalogue.groups.map((g) => option({ scope: 'group', id: g.id }, g.name))}</optgroup>
        )}
      </select>
    </BaseModal>
  )
}
