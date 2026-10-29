'use client'

/**
 * "Move to folder…" / "Copy to folder…" for any folder-of-items tier — pick
 * where in one tier to file one or more items.
 *
 * The tier's folder tree as an indented list, top level first; for a move,
 * the folder the items already share is shown but can't be chosen (a copy
 * may land beside its original). **New folder…** opens an input under the
 * highlighted folder and creates it there, then highlights it. The caller
 * supplies the tree, the folder creator and any extra choice (the wardrobe's
 * components fieldset) as `children`; **Move** / **Copy** hands the folder to
 * `onSubmit`.
 *
 * @module components/item-browser/ItemFolderPickerDialog
 */

import { useState, type ReactNode } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { Icon } from '@/components/ui/icon'
import { folderName, folderSegments, isSameFolder, joinFolder } from '@/lib/mount-index/item-folders'
import { showErrorToast } from '@/lib/toast'

export interface ItemFolderPickerDialogProps {
  isOpen: boolean
  mode: 'move' | 'copy'
  /** What is being moved, for the title. */
  subject: string
  /** The tier's folder paths. */
  folders: ReadonlyArray<{ path: string }>
  loading: boolean
  /** The root row's label, e.g. `Wardrobe (top level)`. */
  rootLabel: string
  /** Create a folder (full path) and answer its stored path. */
  onCreateFolder: (path: string) => Promise<{ path: string }>
  creating: boolean
  /** The folder every item already sits in (disabled for a move), or null. */
  currentFolder: string | null
  working?: boolean
  /** The explanatory line under the title. */
  note: string
  onClose: () => void
  onSubmit: (folder: string) => void | Promise<void>
  /** Extra choices shown under the list (the wardrobe's components fieldset). */
  children?: ReactNode
}

export function ItemFolderPickerDialog({
  isOpen,
  mode,
  subject,
  folders,
  loading,
  rootLabel,
  onCreateFolder,
  creating,
  currentFolder,
  working = false,
  note,
  onClose,
  onSubmit,
  children,
}: ItemFolderPickerDialogProps) {
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const rows = [{ path: '', label: rootLabel, depth: 0 }].concat(
    folders.map((f) => ({ path: f.path, label: folderName(f.path), depth: folderSegments(f.path).length })),
  )

  // A copy may land in the folder it came from; a move there would do nothing.
  const isCurrent = (path: string): boolean =>
    mode === 'move' && currentFolder !== null && isSameFolder(path, currentFolder)
  const target = highlighted
  const canSubmit = target !== null && !isCurrent(target) && !working
  const verb = mode === 'move' ? 'Move' : 'Copy'

  const submitNewFolder = async (): Promise<void> => {
    const name = newFolderName.trim()
    if (!name) return
    try {
      const created = await onCreateFolder(joinFolder(highlighted ?? '', name))
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
        disabled={creating || !newFolderName.trim()}
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
      title={`${verb} ${subject} to a folder`}
      maxWidth="md"
      closeOnClickOutside={!working}
      closeOnEscape={!working}
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
            <button type="button" onClick={onClose} className="qt-button-secondary qt-button-sm" disabled={working}>
              Cancel
            </button>
            <button
              type="button"
              className="qt-button-primary qt-button-sm"
              disabled={!canSubmit}
              onClick={() => target !== null && void onSubmit(target)}
            >
              {working ? (mode === 'move' ? 'Moving…' : 'Copying…') : verb}
            </button>
          </div>
        </div>
      )}
    >
      <p className="qt-text-xs qt-text-secondary mb-2">{note}</p>
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
      {children}
    </BaseModal>
  )
}
