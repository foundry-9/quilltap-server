'use client'

/**
 * "Move to folder…" / "Copy to folder…" — pick where in one wardrobe to file
 * one or more items, or copies of them. The picker itself is the shared
 * `ItemFolderPickerDialog` (`components/item-browser/`); this adds the
 * wardrobe's folder tree and the outfit components choice.
 *
 * The wardrobe's folder tree (`?action=folders`) as an indented list with the
 * top level first; for a move, the folder the items already share is shown
 * but can't be chosen (a copy may land beside its original). **New folder…**
 * opens an input under the highlighted folder and creates the folder there,
 * then highlights it. When any of the items is an outfit, the same
 * all-or-nothing components choice the cross-wardrobe transfer offers comes
 * along (`WardrobeComponentModeFieldset`). **Move** / **Copy** hands the
 * folder and that choice to `onSubmit` (one `move-items` / `copy-items`
 * call). Filing changes nothing about what anyone can wear.
 *
 * @module components/wardrobe/WardrobeFolderPickerDialog
 */

import { useEffect, useState } from 'react'
import { ItemFolderPickerDialog } from '@/components/item-browser/ItemFolderPickerDialog'
import { useWardrobeFolderMutations, useWardrobeFolders } from '@/lib/hooks/use-wardrobe-folders'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'
import {
  WardrobeComponentModeFieldset,
  defaultComponentMode,
  type ComponentMode,
} from './WardrobeComponentModeFieldset'

interface WardrobeFolderPickerDialogProps {
  isOpen: boolean
  /** Move the items, or file copies of them. */
  mode: 'move' | 'copy'
  /** The wardrobe the items live in — the only one whose folders are offered. */
  container: WardrobeContainer
  /** What is being moved, for the title: one item's title, or a count. */
  subject: string
  /**
   * The outfits among the items (composites). When there are any, the
   * components choice is offered; otherwise nothing is asked.
   */
  outfits?: ReadonlyArray<{ componentItemIds: readonly string[] }>
  /**
   * The folder every item being moved already sits in (disabled in the
   * list), or null when they come from different folders.
   */
  currentFolder: string | null
  /** Busy while the move or copy is in flight. */
  working?: boolean
  onClose: () => void
  /** `components` is set only when outfits were among the items. */
  onSubmit: (folder: string, components?: ComponentMode) => void | Promise<void>
}

export function WardrobeFolderPickerDialog({
  isOpen,
  mode,
  container,
  subject,
  outfits = [],
  currentFolder,
  working = false,
  onClose,
  onSubmit,
}: WardrobeFolderPickerDialogProps) {
  const { folders, loading } = useWardrobeFolders(isOpen ? container : null)
  const { createFolder, pending } = useWardrobeFolderMutations()
  const [componentMode, setComponentMode] = useState<ComponentMode>(defaultComponentMode(mode))

  useEffect(() => {
    if (!isOpen) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- modal reset on open
    setComponentMode(defaultComponentMode(mode))
  }, [isOpen, mode])

  const hasOutfits = outfits.length > 0
  const componentCount = outfits.reduce((n, o) => n + o.componentItemIds.length, 0)
  const componentsLegend =
    outfits.length === 1
      ? `This outfit bundles ${componentCount} ${componentCount === 1 ? 'component' : 'components'}`
      : `${outfits.length} of these are outfits, bundling ${componentCount} ${componentCount === 1 ? 'component' : 'components'} between them`

  return (
    <ItemFolderPickerDialog
      isOpen={isOpen}
      mode={mode}
      subject={subject}
      folders={folders}
      loading={loading}
      rootLabel="Wardrobe (top level)"
      onCreateFolder={(path) => createFolder(container, path)}
      creating={pending}
      currentFolder={currentFolder}
      working={working}
      note={
        mode === 'move'
          ? 'Folders are for your browsing; what anyone can wear stays exactly as it was.'
          : 'Each copy is a new item with its own ID and a "(copy)" title, filed in the folder you choose.'
      }
      onClose={onClose}
      onSubmit={(folder) => onSubmit(folder, hasOutfits ? componentMode : undefined)}
    >
      {hasOutfits && (
        <div className="mt-3">
          <WardrobeComponentModeFieldset
            mode={mode}
            value={componentMode}
            onChange={setComponentMode}
            legend={componentsLegend}
            destination="folder"
            name="wardrobe-folder-components"
            disabled={working}
          />
        </div>
      )}
    </ItemFolderPickerDialog>
  )
}
