'use client'

/**
 * One file in a document-store browser's picture view: a large square with
 * the image itself (an image file) or the glyph for its kind, and the name
 * and modified date laid over its foot. The checkbox (select mode) and the
 * ⋮ menu sit over its top corners; rename happens in place over the caption.
 * The list view's counterpart is `DocumentRow`; both share `document-item`.
 *
 * The menu and the rename box are siblings of the tile's button, not inside
 * it: a button may not hold another control, and the ⋮ menu is fixed to the
 * viewport, which a transformed or clipped ancestor would break.
 *
 * @module components/document-browser/DocumentTile
 */

import { Icon } from '@/components/ui/icon'
import { ItemActionMenu } from '@/components/item-browser/ItemActionMenu'
import { folderCrumb } from '@/lib/mount-index/item-folders'
import { buildMountFileRawUrl } from '@/components/files/mountBlobUrl'
import { DocumentRenameInput, formatModified, KIND_ICONS, useDocumentItem, type DocumentItemProps } from './document-item'

export function DocumentTile({
  entry,
  actions,
  onAction,
  onRename,
  selectMode,
  selected,
  onToggle,
  showFolder,
}: DocumentItemProps) {
  const { kind, renaming, name, setName, submit, cancel, menuEntries } = useDocumentItem({ entry, actions, onAction, onRename })
  const detail = showFolder && entry.folder
    ? `${folderCrumb(entry.folder)} · ${formatModified(entry.lastModified)}`
    : formatModified(entry.lastModified)

  return (
    <div className="relative" data-testid="document-tile" data-path={entry.relativePath}>
      <button
        type="button"
        className={`qt-card-interactive p-0 relative block w-full aspect-square overflow-hidden ${selected ? 'qt-border-primary' : ''}`}
        title={entry.relativePath}
        aria-label={selectMode ? `Select ${entry.fileName}` : `Open ${entry.fileName}`}
        aria-pressed={selectMode ? selected : undefined}
        onClick={() => (selectMode ? onToggle() : onAction('open', entry))}
      >
        {kind === 'image' ? (
          <img
            src={buildMountFileRawUrl(entry.mountPointId, entry.relativePath)}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center pb-8 qt-text-secondary">
            <Icon name={KIND_ICONS[kind]} className="w-12 h-12" />
          </span>
        )}
        {!renaming && (
          <span className="qt-gallery-caption absolute inset-x-0 bottom-0 px-2 pt-6 pb-1.5 text-left pointer-events-none">
            <span className="qt-gallery-caption-title block truncate text-xs">{entry.fileName}</span>
            <span className="qt-gallery-caption-detail block truncate">{detail}</span>
          </span>
        )}
      </button>
      {renaming && (
        <div className="absolute inset-x-1 bottom-1 z-10">
          <DocumentRenameInput
            entry={entry}
            name={name}
            setName={setName}
            submit={submit}
            cancel={cancel}
            className="qt-input qt-input-sm w-full"
          />
        </div>
      )}
      {selectMode && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${entry.fileName}`}
          className="absolute top-2 left-2 z-10"
        />
      )}
      {!renaming && (
        <div className="absolute top-1 right-1 z-10">
          <ItemActionMenu
            label={`Actions for ${entry.fileName}`}
            entries={menuEntries}
            disabled={selectMode}
            trigger={{
              content: '⋮',
              ariaLabel: `Actions for ${entry.fileName}`,
              className: 'qt-bg-overlay-caption qt-text-overlay hover:qt-bg-overlay-btn rounded px-2 py-0.5 text-sm',
            }}
          />
        </div>
      )}
    </div>
  )
}
