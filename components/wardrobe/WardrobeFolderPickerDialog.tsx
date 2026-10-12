'use client'

/**
 * "Move to folder…" — pick where in one wardrobe to file one or more items.
 *
 * The wardrobe's folder tree (`?action=folders`) as an indented list with the
 * top level first; the folder the items already share is shown but can't be
 * chosen. **New folder…** opens an input under the highlighted folder and
 * creates the folder there, then highlights it. **Move** files the items with
 * one `move-items` call. Filing changes nothing about what anyone can wear.
 *
 * @module components/wardrobe/WardrobeFolderPickerDialog
 */

import { useMemo, useState } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { Icon } from '@/components/ui/icon'
import { useWardrobeFolderMutations, useWardrobeFolders } from '@/lib/hooks/use-wardrobe-folders'
import {
  folderName,
  folderSegments,
  isSameFolder,
  joinFolder,
} from '@/lib/wardrobe/folders'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'
import { showErrorToast } from '@/lib/toast'

interface WardrobeFolderPickerDialogProps {
  isOpen: boolean
  /** The wardrobe the items live in — the only one whose folders are offered. */
  container: WardrobeContainer
  /** What is being moved, for the title: one item's title, or a count. */
  subject: string
  /**
   * The folder every item being moved already sits in (disabled in the
   * list), or null when they come from different folders.
   */
  currentFolder: string | null
  /** Busy while the move is in flight. */
  moving?: boolean
  onClose: () => void
  onMove: (folder: string) => void | Promise<void>
}

export function WardrobeFolderPickerDialog({
  isOpen,
  container,
  subject,
  currentFolder,
  moving = false,
  onClose,
  onMove,
}: WardrobeFolderPickerDialogProps) {
  const { folders, loading } = useWardrobeFolders(isOpen ? container : null)
  const { createFolder, pending } = useWardrobeFolderMutations()
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const rows = useMemo(
    () => [{ path: '', label: 'Wardrobe (top level)', depth: 0 }].concat(
      folders.map((f) => ({ path: f.path, label: folderName(f.path), depth: folderSegments(f.path).length })),
    ),
    [folders],
  )

  const isCurrent = (path: string): boolean => currentFolder !== null && isSameFolder(path, currentFolder)
  const target = highlighted
  const canMove = target !== null && !isCurrent(target) && !moving

  const submitNewFolder = async (): Promise<void> => {
    const name = newFolderName.trim()
    if (!name) return
    try {
      const created = await createFolder(container, joinFolder(highlighted ?? '', name))
      setHighlighted(created.path)
      setNewFolderOpen(false)
      setNewFolderName('')
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'The folder would not be made')
    }
  }

  const newFolderInput = (
    <div className="flex items-center gap-2 px-2 py-1" style={{ paddingLeft: `${((highlighted ? folderSegments(highlighted).length : 0) + 1) * 16 + 8}px` }}>
      <input
        type="text"
        autoFocus
        value={newFolderName}
        onChange={(e) => setNewFolderName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submitNewFolder()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            setNewFolderOpen(false)
            setNewFolderName('')
          }
        }}
        placeholder="Folder name"
        aria-label="New folder name"
        className="qt-input qt-input-sm flex-1"
      />
      <button
        type="button"
        className="qt-button-secondary qt-button-sm"
        disabled={pending || !newFolderName.trim()}
        onClick={() => void submitNewFolder()}
      >
        Create
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={`Move ${subject} to a folder`}
      maxWidth="md"
      closeOnClickOutside={!moving}
      closeOnEscape={!moving}
      footer={(
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="qt-button-ghost qt-button-sm"
            onClick={() => setNewFolderOpen(true)}
            disabled={newFolderOpen}
          >
            New folder…
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="qt-button-secondary qt-button-sm" disabled={moving}>
              Cancel
            </button>
            <button
              type="button"
              className="qt-button-primary qt-button-sm"
              disabled={!canMove}
              onClick={() => target !== null && void onMove(target)}
            >
              {moving ? 'Moving…' : 'Move'}
            </button>
          </div>
        </div>
      )}
    >
      <p className="qt-text-xs qt-text-secondary mb-2">
        Folders are for your browsing; what anyone can wear stays exactly as it was.
      </p>
      {loading ? (
        <div className="text-sm qt-text-secondary px-2 py-3">Loading folders…</div>
      ) : (
        <ul role="listbox" aria-label="Folders" className="space-y-0.5 max-h-[50vh] overflow-y-auto">
          {rows.map((row) => {
            const current = isCurrent(row.path)
            const selected = highlighted !== null && isSameFolder(highlighted, row.path)
            return (
              <li key={row.path || '(root)'}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-disabled={current}
                  disabled={current}
                  onClick={() => setHighlighted(row.path)}
                  className={`w-full text-left px-2 py-1 rounded text-sm ${
                    selected ? 'qt-bg-muted text-foreground' : 'qt-text-secondary'
                  } disabled:opacity-50`}
                  style={{ paddingLeft: `${row.depth * 16 + 8}px` }}
                  title={current ? 'Already here' : undefined}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {row.path && <Icon name="folder" className="w-3.5 h-3.5" />}
                    {row.label}
                  </span>
                  {current && <span className="qt-text-xs ml-2">(here now)</span>}
                </button>
                {newFolderOpen && selected && newFolderInput}
              </li>
            )
          })}
          {newFolderOpen && highlighted === null && newFolderInput}
        </ul>
      )}
    </BaseModal>
  )
}
