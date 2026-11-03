'use client'

/**
 * One file in a document-store browser: a thumbnail or type glyph, the name
 * (click to view), size and modified time, chips for a hard link and a
 * conversion that is pending or failed, and the ⋮ menu of
 * the actions `documentFileActions` granted. Rename happens in place.
 *
 * @module components/document-browser/DocumentRow
 */

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { IconName } from '@/components/ui/icons/icon-registry'
import { ItemActionMenu, type MenuEntryLike } from '@/components/item-browser/ItemActionMenu'
import { formatBytes } from '@/lib/utils/format-bytes'
import { folderCrumb } from '@/lib/mount-index/item-folders'
import { documentPreviewKind, type BrowserAction } from '@/lib/folder-browser/document-actions'
import type { PreviewKind } from '@/lib/folder-browser/preview-kind'
import { buildMountFileRawUrl } from '@/components/files/mountBlobUrl'
import type { DocumentEntry } from './useDocumentStoreSource'

const KIND_ICONS: Record<PreviewKind, IconName> = {
  image: 'image',
  pdf: 'file',
  docx: 'file',
  markdown: 'book',
  text: 'file',
  unsupported: 'file',
}

const ACTION_LABELS: Record<BrowserAction, string> = {
  open: 'Open',
  rename: 'Rename',
  move: 'Move to…',
  copy: 'Copy to…',
  link: 'Hard link to…',
  'show-links': 'Where else this appears…',
  unlink: 'Unlink from its twins',
  describe: 'Edit description…',
  workbench: "Open in Pascal's Workbench",
  download: 'Download',
  delete: 'Delete',
}

export interface DocumentRowProps {
  entry: DocumentEntry
  actions: readonly BrowserAction[]
  /** Run an action other than rename (which the row does itself). */
  onAction: (action: BrowserAction, entry: DocumentEntry) => void
  onRename: (entry: DocumentEntry, name: string) => Promise<boolean>
  selectMode: boolean
  selected: boolean
  onToggle: () => void
  /** Show the folder under the name (a search hit). */
  showFolder: boolean
}

function formatModified(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function DocumentRow({
  entry,
  actions,
  onAction,
  onRename,
  selectMode,
  selected,
  onToggle,
  showFolder,
}: DocumentRowProps) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(entry.fileName)
  const kind = documentPreviewKind(entry)

  const submit = async (): Promise<void> => {
    const next = name.trim()
    if (!next || next === entry.fileName) {
      setRenaming(false)
      return
    }
    if (await onRename(entry, next)) setRenaming(false)
  }

  const entries: MenuEntryLike[] = actions.map((action) => ({
    key: action,
    label: ACTION_LABELS[action],
    destructive: action === 'delete',
    onSelect: () => {
      if (action === 'rename') {
        setName(entry.fileName)
        setRenaming(true)
      } else {
        onAction(action, entry)
      }
    },
  }))

  return (
    <div className="qt-card-interactive py-2 px-3 flex items-center gap-3" data-testid="document-row" data-path={entry.relativePath}>
      {selectMode && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${entry.fileName}`}
          className="flex-shrink-0"
        />
      )}
      {kind === 'image' ? (
        <img
          src={buildMountFileRawUrl(entry.mountPointId, entry.relativePath)}
          alt=""
          loading="lazy"
          className="w-8 h-8 rounded object-cover flex-shrink-0 border qt-border-default"
        />
      ) : (
        <Icon name={KIND_ICONS[kind]} className="w-5 h-5 qt-text-secondary flex-shrink-0 mx-1.5" />
      )}
      <div className="flex-1 min-w-0">
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
                setName(entry.fileName)
                setRenaming(false)
              }
            }}
            onBlur={() => void submit()}
            aria-label={`Rename ${entry.fileName}`}
            className="qt-input qt-input-sm w-full"
          />
        ) : (
          <button
            type="button"
            className="block w-full text-left text-sm text-foreground truncate"
            title={entry.relativePath}
            onClick={() => (selectMode ? onToggle() : onAction('open', entry))}
          >
            {entry.fileName}
          </button>
        )}
        {showFolder && entry.folder && (
          <div className="qt-text-xs qt-text-secondary truncate">{folderCrumb(entry.folder)}</div>
        )}
      </div>
      <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
        {entry.linkGroupId && (
          <span className="qt-badge-info" title="Hard-linked: an edit here reaches every twin">
            Hard-linked
          </span>
        )}
        {entry.conversionStatus === 'failed' && (
          <span className="qt-badge-destructive" title={entry.conversionError ?? undefined}>
            Conversion failed
          </span>
        )}
        {entry.conversionStatus === 'pending' && ['pdf', 'docx'].includes(entry.fileType) && (
          <span className="qt-badge-warning">Converting</span>
        )}
      </div>
      <span className="qt-text-xs qt-text-secondary flex-shrink-0 w-16 text-right">{formatBytes(entry.fileSizeBytes)}</span>
      <span className="qt-text-xs qt-text-secondary flex-shrink-0 w-24 text-right hidden md:inline">
        {formatModified(entry.lastModified)}
      </span>
      <ItemActionMenu label={`Actions for ${entry.fileName}`} entries={entries} disabled={selectMode} />
    </div>
  )
}
