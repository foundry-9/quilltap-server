'use client'

/**
 * One subfolder in a folder-of-items browser (the wardrobe's, the
 * Inventory's): open it, or — where the browser manages folders — rename or
 * delete it from its ⋮ menu (`ItemActionMenu`, so the keyboard, Escape and
 * an outside click all close it).
 *
 * @module components/item-browser/ItemFolderRow
 */

import { useState } from 'react'
import { ItemActionMenu, type MenuEntryLike } from './ItemActionMenu'
import { Icon } from '@/components/ui/icon'

export interface ItemFolderRowView {
  path: string
  name: string
  itemCount: number
}

export interface ItemFolderRowProps {
  row: ItemFolderRowView
  /** Rename / Delete are offered only where folders are managed. */
  manageable: boolean
  onOpen: () => void
  onRename: (name: string) => Promise<boolean>
  onDelete: () => void
  /** `data-testid` of the row, e.g. `wardrobe-folder-row`. */
  testId: string
  /** The noun counted, e.g. `item`. */
  countNoun?: string
  /** More ⋮ entries, between Rename and Delete (Move to…, Copy to…). */
  extraEntries?: readonly MenuEntryLike[]
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function ItemFolderRow({
  row,
  manageable,
  onOpen,
  onRename,
  onDelete,
  testId,
  countNoun = 'item',
  extraEntries,
}: ItemFolderRowProps) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(row.name)

  const submit = async (): Promise<void> => {
    const next = name.trim()
    if (!next || next === row.name) {
      setRenaming(false)
      return
    }
    if (await onRename(next)) setRenaming(false)
  }

  return (
    <div className="qt-card-interactive py-2 px-3 flex items-center gap-2" data-testid={testId}>
      <Icon name="folder" className="w-4 h-4 qt-text-secondary flex-shrink-0" />
      {renaming ? (
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              setName(row.name)
              setRenaming(false)
            }
          }}
          onBlur={() => void submit()}
          aria-label={`Rename folder ${row.name}`}
          className="qt-input qt-input-sm flex-1"
        />
      ) : (
        <button type="button" className="flex-1 min-w-0 text-left text-sm text-foreground truncate" onClick={onOpen}>
          {row.name}
        </button>
      )}
      <span className="qt-text-xs qt-text-secondary flex-shrink-0">{plural(row.itemCount, countNoun)}</span>
      {manageable && !renaming && (
        <ItemActionMenu
          label={`Folder actions for ${row.name}`}
          room={120}
          minWidthClass="min-w-[10rem]"
          entries={[
            {
              key: 'rename',
              label: 'Rename',
              onSelect: () => {
                setName(row.name)
                setRenaming(true)
              },
            },
            ...(extraEntries ?? []),
            { key: 'delete', label: 'Delete', destructive: true, onSelect: onDelete },
          ]}
        />
      )}
    </div>
  )
}
