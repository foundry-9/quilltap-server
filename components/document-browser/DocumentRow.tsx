'use client'

/**
 * One file in a document-store browser's list view: a thumbnail or type
 * glyph, the name (click to view), size and modified time, chips for a hard
 * link and a conversion that is pending or failed, and the ⋮ menu of the
 * actions `documentFileActions` granted. Rename happens in place. The
 * picture view's counterpart is `DocumentTile`; both share `document-item`.
 *
 * @module components/document-browser/DocumentRow
 */

import { Icon } from '@/components/ui/icon'
import { ItemActionMenu } from '@/components/item-browser/ItemActionMenu'
import { formatBytes } from '@/lib/utils/format-bytes'
import { folderCrumb } from '@/lib/mount-index/item-folders'
import { buildMountFileRawUrl } from '@/components/files/mountBlobUrl'
import { DocumentRenameInput, formatModified, KIND_ICONS, useDocumentItem, type DocumentItemProps } from './document-item'

export type DocumentRowProps = DocumentItemProps

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
  const { kind, renaming, name, setName, submit, cancel, menuEntries } = useDocumentItem({ entry, actions, onAction, onRename })

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
          <DocumentRenameInput
            entry={entry}
            name={name}
            setName={setName}
            submit={submit}
            cancel={cancel}
            className="qt-input qt-input-sm w-full"
          />
        ) : (
          <button
            type="button"
            className="block w-full text-left text-sm qt-text truncate"
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
      <ItemActionMenu label={`Actions for ${entry.fileName}`} entries={menuEntries} disabled={selectMode} />
    </div>
  )
}
