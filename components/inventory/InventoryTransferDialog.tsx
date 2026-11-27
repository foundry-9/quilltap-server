'use client'

/**
 * Move or copy one Inventory object to another tier — a character's vault, a
 * group's or project's store, or Quilltap General. A move keeps the object's
 * id (so every chat that carries it, and every kit that names it, still
 * does); a copy is a new object and is offered only when the object can be
 * copied. The folder path comes along. The dialog's chrome is the shared
 * `ItemTransferDialog`.
 *
 * @module components/inventory/InventoryTransferDialog
 */

import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import { GENERAL_INVENTORY_NAME, type InventoryContainer } from '@/lib/inventory/container'
import type { ContainerCatalogue } from '@/lib/hooks/use-container-catalogue'
import { ItemTransferDialog } from '@/components/item-browser/ItemTransferDialog'
import type { InventoryItemActions } from './hooks/useInventoryItemActions'
import { describeInventoryRefusal } from './hooks/useInventoryItemActions'

/** Where an object can go: the shared container catalogue's three lists. */
export type InventoryCatalogue = Pick<ContainerCatalogue, 'characters' | 'projects' | 'groups'>

interface InventoryTransferDialogProps {
  item: ResolvedInventoryItem
  mode: 'move' | 'copy'
  from: InventoryContainer
  catalogue: InventoryCatalogue
  actions: InventoryItemActions
  onClose: () => void
}

export function InventoryTransferDialog({ item, mode, from, catalogue, actions, onClose }: InventoryTransferDialogProps) {
  const label = item.title || item.name
  return (
    <ItemTransferDialog
      mode={mode}
      from={from}
      catalogue={catalogue}
      wording={{
        title: (verb) => `${verb} "${label}" to another inventory`,
        selectId: 'inventory-transfer-target',
        generalName: GENERAL_INVENTORY_NAME,
        placeholder: 'Choose an inventory',
        done: (m) => (m === 'move' ? `"${label}" has changed hands` : `A copy of "${label}" is on its way`),
        describeError: describeInventoryRefusal,
        failed: (m) => `The object would not ${m}`,
      }}
      note={
        <>
          {mode === 'move'
            ? 'The object keeps its identity: chats that carry it, and kits that name it, still do. Its folder comes along.'
            : 'The copy is a new object with its own identity, filed in the same folder at the destination.'}
          {item.parentId && ' An instance stays an instance of its archetype wherever it goes.'}
        </>
      }
      transfer={(to) => actions.mutations.transfer({ action: mode, itemId: item.id, from, to })}
      onClose={onClose}
    />
  )
}
