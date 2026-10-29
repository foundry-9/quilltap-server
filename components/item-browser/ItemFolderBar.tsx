'use client'

/**
 * The folder bar of a folder-of-items browser: the breadcrumb (root, the
 * borrowed tier when inside one, then each folder), and — where folders are
 * managed — New folder and Select. While searching it says so instead.
 *
 * @module components/item-browser/ItemFolderBar
 */

import { folderSegments } from '@/lib/mount-index/item-folders'

export interface ItemFolderBarProps {
  /** The root crumb, e.g. `Wardrobe`. */
  rootLabel: string
  /** The breadcrumb's accessible name, e.g. `Wardrobe folders`. */
  navLabel: string
  searching: boolean
  /** The borrowed tier's label, or null in the browser's own tier. */
  tierLabel: string | null
  currentFolder: string
  onNavigateRoot: () => void
  onNavigateTier: () => void
  onNavigateFolder: (path: string) => void
  /** Folder controls shown (the tier being browsed is the browser's own). */
  managed: boolean
  newFolderOpen: boolean
  onNewFolder: () => void
  selectMode: boolean
  onToggleSelect: () => void
  /** `data-testid`, e.g. `wardrobe-folder-bar`. */
  testId: string
}

export function ItemFolderBar({
  rootLabel,
  navLabel,
  searching,
  tierLabel,
  currentFolder,
  onNavigateRoot,
  onNavigateTier,
  onNavigateFolder,
  managed,
  newFolderOpen,
  onNewFolder,
  selectMode,
  onToggleSelect,
  testId,
}: ItemFolderBarProps) {
  const inOwnTier = tierLabel === null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid={testId}>
      <nav aria-label={navLabel} className="flex flex-wrap items-center gap-1 qt-text-xs min-w-0">
        {searching ? (
          <span className="qt-text-secondary">Searching everywhere</span>
        ) : (
          <>
            <button
              type="button"
              className="qt-text-secondary hover:text-foreground"
              onClick={onNavigateRoot}
              aria-current={inOwnTier && currentFolder === '' ? 'page' : undefined}
            >
              {rootLabel}
            </button>
            {!inOwnTier && (
              <>
                <span className="qt-text-secondary" aria-hidden>›</span>
                <button
                  type="button"
                  className="qt-text-secondary hover:text-foreground"
                  onClick={onNavigateTier}
                  aria-current={currentFolder === '' ? 'page' : undefined}
                >
                  {tierLabel}
                </button>
              </>
            )}
            {folderSegments(currentFolder).map((segment, idx, all) => {
              const path = all.slice(0, idx + 1).join('/')
              const last = idx === all.length - 1
              return (
                <span key={path} className="inline-flex items-center gap-1">
                  <span className="qt-text-secondary" aria-hidden>›</span>
                  <button
                    type="button"
                    className={last ? 'text-foreground font-medium' : 'qt-text-secondary hover:text-foreground'}
                    onClick={() => onNavigateFolder(path)}
                    aria-current={last ? 'page' : undefined}
                  >
                    {segment}
                  </button>
                </span>
              )
            })}
          </>
        )}
      </nav>
      {managed && (
        <div className="flex items-center gap-1">
          {!searching && (
            <button type="button" className="qt-button-ghost qt-button-sm" onClick={onNewFolder} disabled={newFolderOpen}>
              New folder
            </button>
          )}
          <button
            type="button"
            className={`qt-button-sm ${selectMode ? 'qt-button-secondary' : 'qt-button-ghost'}`}
            aria-pressed={selectMode}
            onClick={onToggleSelect}
          >
            Select
          </button>
        </div>
      )}
    </div>
  )
}

export interface NewFolderInputProps {
  name: string
  onChange: (name: string) => void
  onSubmit: () => void
  onCancel: () => void
}

/** The inline "new folder" name input under the folder bar. */
export function NewFolderInput({ name, onChange, onSubmit, onCancel }: NewFolderInputProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        autoFocus
        value={name}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSubmit()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
        placeholder="Folder name — Enter to make it, Esc to think better of it"
        aria-label="New folder name"
        className="qt-input qt-input-sm flex-1"
      />
    </div>
  )
}
