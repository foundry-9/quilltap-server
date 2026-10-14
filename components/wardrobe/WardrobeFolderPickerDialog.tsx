'use client'

/**
 * "Move to folder…" / "Copy to folder…" — pick where in one wardrobe to file
 * one or more items, or copies of them.
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

import { useEffect, useMemo, useState } from 'react'
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
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [componentMode, setComponentMode] = useState<ComponentMode>(defaultComponentMode(mode))

  useEffect(() => {
    if (!isOpen) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- modal reset on open
    setComponentMode(defaultComponentMode(mode))
  }, [isOpen, mode])

  const rows = useMemo(
    () => [{ path: '', label: 'Wardrobe (top level)', depth: 0 }].concat(
      folders.map((f) => ({ path: f.path, label: folderName(f.path), depth: folderSegments(f.path).length })),
    ),
    [folders],
  )

  // A copy may land in the folder it came from; a move there would do nothing.
  const isCurrent = (path: string): boolean =>
    mode === 'move' && currentFolder !== null && isSameFolder(path, currentFolder)
  const target = highlighted
  const canSubmit = target !== null && !isCurrent(target) && !working
  const hasOutfits = outfits.length > 0
  const componentCount = outfits.reduce((n, o) => n + o.componentItemIds.length, 0)
  const componentsLegend =
    outfits.length === 1
      ? `This outfit bundles ${componentCount} ${componentCount === 1 ? 'component' : 'components'}`
      : `${outfits.length} of these are outfits, bundling ${componentCount} ${componentCount === 1 ? 'component' : 'components'} between them`
  const verb = mode === 'move' ? 'Move' : 'Copy'

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
              onClick={() => target !== null && void onSubmit(target, hasOutfits ? componentMode : undefined)}
            >
              {working ? (mode === 'move' ? 'Moving…' : 'Copying…') : verb}
            </button>
          </div>
        </div>
      )}
    >
      <p className="qt-text-xs qt-text-secondary mb-2">
        {mode === 'move'
          ? 'Folders are for your browsing; what anyone can wear stays exactly as it was.'
          : 'Each copy is a new item with its own ID and a "(copy)" title, filed in the folder you choose.'}
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
    </BaseModal>
  )
}
