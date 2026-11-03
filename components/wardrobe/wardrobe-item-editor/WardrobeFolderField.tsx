'use client'

/**
 * The wardrobe item editor's Folder field: the shared `ItemFolderField` over
 * the destination wardrobe's folders. Filing only — a folder says nothing
 * about when the garment is worn.
 *
 * @module components/wardrobe/wardrobe-item-editor/WardrobeFolderField
 */

import { useWardrobeFolders } from '@/lib/hooks/use-wardrobe-folders'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'
import { ItemFolderField } from '@/components/item-browser/ItemFolderField'

interface WardrobeFolderFieldProps {
  /** The wardrobe the item is (or will be) filed in; null while unknown. */
  container: WardrobeContainer | null
  value: string
  onChange: (folder: string) => void
}

export function WardrobeFolderField({ container, value, onChange }: WardrobeFolderFieldProps) {
  const { folders } = useWardrobeFolders(container)
  return (
    <ItemFolderField
      id="wardrobe-folder"
      folders={folders}
      value={value}
      onChange={onChange}
      rootLabel="Wardrobe (top level)"
      placeholder="e.g., Formal/Evening"
      hint="Where it is filed for your browsing. Folders never change what anyone can wear."
    />
  )
}
