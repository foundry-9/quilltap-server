'use client'

/**
 * One subfolder in a folder-of-items browser (the wardrobe's, the
 * Inventory's): open it, or — where the browser manages folders — rename or
 * delete it from its ⋮ menu (`ItemActionMenu`, so the keyboard, Escape and
 * an outside click all close it). `tile` draws it as a square for a
 * browser's picture view.
 *
 * @module components/item-browser/ItemFolderRow
 */

import { useState } from 'react'
import { ItemActionMenu, type MenuEntryLike } from './ItemActionMenu'
import { Icon } from '@/components/ui/icon'
import { pluralize as plural } from '@/lib/folder-browser/view'

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
  /** Draw it as a square tile (a browser's picture view) rather than a row. */
  tile?: boolean
}


export function ItemFolderRow({
  row,
  manageable,
  onOpen,
  onRename,
  onDelete,
  testId,
  countNoun = 'item',
  extraEntries,
  tile = false,
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

  const renameInput = (className: string) => (
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
      className={className}
    />
  )

  const menu = (trigger?: { content: string; ariaLabel: string; className: string }) =>
    manageable && !renaming ? (
      <ItemActionMenu
        label={`Folder actions for ${row.name}`}
        room={120}
        minWidthClass="min-w-[10rem]"
        trigger={trigger}
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
    ) : null

  if (tile) {
    // The menu and the rename box sit beside the button, not in it: a button
    // may not hold another control, and the fixed ⋮ menu needs an ancestor
    // that is neither transformed nor clipped.
    return (
      <div className="relative" data-testid={testId}>
        <button
          type="button"
          className="qt-card-interactive p-0 relative block w-full aspect-square overflow-hidden"
          title={row.path}
          aria-label={`Open folder ${row.name}`}
          onClick={onOpen}
        >
          <span className="absolute inset-0 flex items-center justify-center pb-8 qt-text-secondary">
            <Icon name="folder" className="w-14 h-14" />
          </span>
          {!renaming && (
            <span className="qt-gallery-caption absolute inset-x-0 bottom-0 px-2 pt-6 pb-1.5 text-left pointer-events-none">
              <span className="qt-gallery-caption-title block truncate text-xs">{row.name}</span>
              <span className="qt-gallery-caption-detail block truncate">{plural(row.itemCount, countNoun)}</span>
            </span>
          )}
        </button>
        {renaming && <div className="absolute inset-x-1 bottom-1 z-10">{renameInput('qt-input qt-input-sm w-full')}</div>}
        <div className="absolute top-1 right-1 z-10">
          {menu({
            content: '⋮',
            ariaLabel: `Folder actions for ${row.name}`,
            className: 'qt-bg-overlay-caption qt-text-overlay hover:qt-bg-overlay-btn rounded px-2 py-0.5 text-sm',
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="qt-card-interactive py-2 px-3 flex items-center gap-2" data-testid={testId}>
      <Icon name="folder" className="w-4 h-4 qt-text-secondary flex-shrink-0" />
      {renaming ? (
        renameInput('qt-input qt-input-sm flex-1')
      ) : (
        <button type="button" className="flex-1 min-w-0 text-left text-sm qt-text truncate" onClick={onOpen}>
          {row.name}
        </button>
      )}
      <span className="qt-text-xs qt-text-secondary flex-shrink-0">{plural(row.itemCount, countNoun)}</span>
      {menu()}
    </div>
  )
}
