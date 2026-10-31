'use client'

/**
 * "Move to folder…" / "Copy to folder…" for Inventory objects: the shared
 * `DestinationPickerDialog` over one tier's `Inventory/` folders. A copy is a
 * new object (offered only for copyable ones); the server refuses the rest.
 *
 * @module components/inventory/InventoryFolderPickerDialog
 */

import { useState } from 'react'
import { DestinationPickerDialog } from '@/components/item-browser/DestinationPickerDialog'
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
  mode,
  actions,
  onClose,
}: {
  container: InventoryContainer
  items: ResolvedInventoryItem[]
  mode: 'move' | 'copy'
  actions: InventoryItemActions
  onClose: () => void
}) {
  const { folders, loading } = useInventoryFolders(container)
  const [working, setWorking] = useState(false)
  const first = items[0]?.folder ?? ''
  const currentFolder = items.every((i) => isSameFolder(i.folder ?? '', first)) ? first : null
  const subject = items.length === 1 ? `"${items[0].title || items[0].name}"` : `${items.length} objects`

  return (
    <DestinationPickerDialog
      isOpen
      mode={mode}
      subject={subject}
      folders={folders}
      loading={loading}
      rootLabel="Inventory (top level)"
      onCreateFolder={(path) => actions.mutations.createFolder(container, path)}
      creating={actions.mutations.pending}
      currentFolder={currentFolder}
      working={working}
      note={
        mode === 'copy'
          ? 'Each copy is a new object of its own; nobody carries it until it is equipped.'
          : 'Folders are for your browsing; what anyone carries stays exactly as it was.'
      }
      onClose={onClose}
      onSubmit={async (folder) => {
        setWorking(true)
        try {
          await actions.mutations.fileItems(mode, container, items.map((i) => i.id), folder)
          const where = folder ? `"${folderCrumb(folder)}"` : 'the top of the inventory'
          showSuccessToast(
            mode === 'copy'
              ? `${items.length === 1 ? 'A copy' : 'Copies'} of ${subject} now ${items.length === 1 ? 'sits' : 'sit'} in ${where}`
              : `${subject} now ${items.length === 1 ? 'sits' : 'sit'} in ${where}`,
          )
          onClose()
        } catch (error) {
          showErrorToast(describeInventoryRefusal(error, mode === 'copy' ? 'The objects would not be copied' : 'The objects would not be moved'))
        } finally {
          setWorking(false)
        }
      }}
    />
  )
}
