'use client'

/**
 * One subfolder in a folder-of-items browser (the wardrobe's, the
 * Inventory's): open it, or — where the browser manages folders — rename or
 * delete it from its ⋮ menu.
 *
 * @module components/item-browser/ItemFolderRow
 */

import { useRef, useState } from 'react'
import { useFixedMenu } from '@/hooks/useFixedMenu'
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
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function ItemFolderRow({ row, manageable, onOpen, onRename, onDelete, testId, countNoun = 'item' }: ItemFolderRowProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const { anchorRef, menuStyle, open: menuOpen, setOpen: setMenuOpen, close: closeMenu } = useFixedMenu(menuRef, 120)
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
        <div className="relative" ref={menuRef}>
          <button
            ref={anchorRef}
            type="button"
            className="qt-button-ghost qt-button-sm"
            aria-label={`Folder actions for ${row.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            ⋮
          </button>
          {menuOpen && (
            <div
              role="menu"
              style={menuStyle ?? undefined}
              className="z-30 min-w-[10rem] rounded border qt-border-default qt-bg-popover shadow-md"
              onMouseLeave={() => closeMenu()}
            >
              <ul className="divide-y qt-border-default">
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full text-left px-3 py-2 text-sm hover:qt-bg-muted"
                    onClick={() => {
                      closeMenu()
                      setName(row.name)
                      setRenaming(true)
                    }}
                  >
                    Rename
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full text-left px-3 py-2 text-sm qt-text-destructive hover:qt-bg-muted"
                    onClick={() => {
                      closeMenu()
                      onDelete()
                    }}
                  >
                    Delete
                  </button>
                </li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
