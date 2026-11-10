'use client'

/**
 * Atlas Entry Row — one entry in the Atlas browser.
 *
 * The current picture as a thumbnail (the `atlas` icon when there is none),
 * the canonical name, its aliases, and the graphic prompt truncated to one
 * line, with chips for the tier an entry is borrowed from and *archived*. The
 * ⋮ menu holds Edit, Duplicate, Move / Copy to folder…, Move / Copy to
 * another atlas…, Archive / Restore and Delete — through the shared
 * `ItemActionMenu`.
 *
 * @module components/atlas/atlas-entry-row
 */

import { ItemActionMenu } from '@/components/item-browser/ItemActionMenu'
import { Icon } from '@/components/ui/icon'
import type { AtlasEntryWithOrigin } from '@/lib/schemas/atlas.types'
import { atlasOriginLabel } from '@/lib/atlas/container'

export interface AtlasRowActions {
  onEdit: (entry: AtlasEntryWithOrigin) => void
  onDuplicate: (entry: AtlasEntryWithOrigin) => void
  onMoveToFolder: (entry: AtlasEntryWithOrigin) => void
  onCopyToFolder: (entry: AtlasEntryWithOrigin) => void
  onTransfer: (entry: AtlasEntryWithOrigin, mode: 'move' | 'copy') => void
  onToggleArchived: (entry: AtlasEntryWithOrigin) => void
  onDelete: (entry: AtlasEntryWithOrigin) => void
}

interface AtlasEntryRowProps {
  entry: AtlasEntryWithOrigin
  /** The entry lives in the tier being browsed. */
  manageable: boolean
  actions: AtlasRowActions
  selection?: { selected: boolean; onToggle: (entry: AtlasEntryWithOrigin) => void }
  /** A search hit's folder. */
  folderCrumb?: string | null
}

/** An entry's current picture, or the Atlas's icon. */
export function AtlasEntryPicture({ entry, size = 40 }: { entry: Pick<AtlasEntryWithOrigin, 'name' | 'imageFileId'>; size?: number }) {
  if (entry.imageFileId) {
    return (
      <img
        src={`/api/v1/files/${entry.imageFileId}?action=thumbnail`}
        alt={`Picture of ${entry.name}`}
        width={size}
        height={size}
        className="rounded object-cover border qt-border-default shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded border qt-border-default qt-bg-muted shrink-0"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon name="atlas" className="w-5 h-5 qt-text-secondary" />
    </span>
  )
}

export function AtlasEntryRow({ entry, manageable, actions, selection, folderCrumb }: AtlasEntryRowProps) {
  const borrowed = manageable ? null : atlasOriginLabel(entry.origin)
  const run = (fn: (e: AtlasEntryWithOrigin) => void) => () => fn(entry)
  const aliases = entry.aliases ?? []
  const prompt = entry.graphicPrompt?.trim() ?? ''

  return (
    <div
      className={`qt-card py-2 px-3 flex items-center gap-2 ${entry.archivedAt ? 'opacity-60' : ''}`}
      data-testid="atlas-entry-row"
    >
      {selection && manageable && (
        <input
          type="checkbox"
          className="qt-checkbox"
          checked={selection.selected}
          onChange={() => selection.onToggle(entry)}
          aria-label={`Select ${entry.name}`}
        />
      )}
      <AtlasEntryPicture entry={entry} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground truncate" title={entry.name}>
          {entry.name}
          {aliases.length > 0 && (
            <span className="qt-text-xs qt-text-secondary ml-1">also {aliases.join(', ')}</span>
          )}
        </div>
        {prompt && (
          <div className="qt-text-xs qt-text-secondary truncate" title={prompt}>
            {prompt}
          </div>
        )}
        {(borrowed || entry.archivedAt || folderCrumb) && (
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            {borrowed && <span className="qt-badge qt-badge-wardrobe-shared">{borrowed}</span>}
            {entry.archivedAt && <span className="qt-badge qt-badge-secondary">archived</span>}
            {folderCrumb && (
              <span className="qt-text-xs qt-text-secondary" data-testid="atlas-folder-crumb">
                {folderCrumb}
              </span>
            )}
          </div>
        )}
      </div>

      <ItemActionMenu
        disabled={!!selection}
        entries={[
          manageable && { key: 'edit', label: 'Edit', onSelect: run(actions.onEdit) },
          manageable && { key: 'duplicate', label: 'Duplicate', onSelect: run(actions.onDuplicate) },
          manageable && { key: 'move-to-folder', label: 'Move to folder…', onSelect: run(actions.onMoveToFolder) },
          manageable && { key: 'copy-to-folder', label: 'Copy to folder…', onSelect: run(actions.onCopyToFolder) },
          manageable && { key: 'transfer-move', label: 'Move to another atlas…', onSelect: () => actions.onTransfer(entry, 'move') },
          { key: 'transfer-copy', label: 'Copy to another atlas…', onSelect: () => actions.onTransfer(entry, 'copy') },
          manageable && { key: 'archive', label: entry.archivedAt ? 'Restore' : 'Archive', onSelect: run(actions.onToggleArchived) },
          manageable && { key: 'delete', label: 'Delete', destructive: true, onSelect: run(actions.onDelete) },
        ]}
      />
    </div>
  )
}
