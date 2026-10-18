'use client'

/**
 * "Move to folder…" for Inventory objects: the shared
 * `ItemFolderPickerDialog` over one tier's `Inventory/` folders.
 *
 * @module components/inventory/InventoryFolderPickerDialog
 */

import { useState } from 'react'
import { ItemFolderPickerDialog } from '@/components/item-browser/ItemFolderPickerDialog'
import { useInventoryFolders } from '@/lib/hooks/use-inventory'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { folderCrumb, isSameFolder } from '@/lib/inventory/folders'
import type { InventoryContainer } from '@/lib/inventory/container'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import type { InventoryItemActions } from './hooks/useInventoryItemActions'
import { describeInventoryRefusal } from './hooks/useInventoryItemActions'

export function InventoryFolderPickerDialog({
  container,
  items,
  actions,
  onClose,
}: {
  container: InventoryContainer
  items: ResolvedInventoryItem[]
  actions: InventoryItemActions
  onClose: () => void
}) {
  const { folders, loading } = useInventoryFolders(container)
  const [working, setWorking] = useState(false)
  const first = items[0]?.folder ?? ''
  const currentFolder = items.every((i) => isSameFolder(i.folder ?? '', first)) ? first : null
  const subject = items.length === 1 ? `"${items[0].title || items[0].name}"` : `${items.length} objects`

  return (
    <ItemFolderPickerDialog
      isOpen
      mode="move"
      subject={subject}
      folders={folders}
      loading={loading}
      rootLabel="Inventory (top level)"
      onCreateFolder={(path) => actions.mutations.createFolder(container, path)}
      creating={actions.mutations.pending}
      currentFolder={currentFolder}
      working={working}
      note="Folders are for your browsing; what anyone carries stays exactly as it was."
      onClose={onClose}
      onSubmit={async (folder) => {
        setWorking(true)
        try {
          await actions.mutations.fileItems('move', container, items.map((i) => i.id), folder)
          showSuccessToast(`${subject} now ${items.length === 1 ? 'sits' : 'sit'} in ${folder ? `"${folderCrumb(folder)}"` : 'the top of the inventory'}`)
          onClose()
        } catch (error) {
          showErrorToast(describeInventoryRefusal(error, 'The objects would not be moved'))
        } finally {
          setWorking(false)
        }
      }}
    />
  )
}
