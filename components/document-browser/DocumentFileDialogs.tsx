'use client'

/**
 * The two small dialogs a document-store file's ⋮ menu opens:
 *
 *   - **Where else this appears** — every location sharing the file's
 *     content, with the hard-linked ones marked, and a way to go to each;
 *   - **Description** — the searchable description (or transcript) a stored
 *     blob carries.
 *
 * @module components/document-browser/DocumentFileDialogs
 */

import { useState } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { apiErrorMessage } from '@/lib/query/fetcher'
import { useDocumentFileLinks } from './useDocumentStoreSource'
import type { DocMountLinkLocation } from '@/lib/schemas/mount-index.types'

export interface DocumentLinksDialogProps {
  storeId: string
  /** The file asked about; null closes the dialog. */
  path: string | null
  onClose: () => void
  /** Go to a location (this store's folder, or another store). */
  onReveal: (location: DocMountLinkLocation) => void
}

export function DocumentLinksDialog({ storeId, path, onClose, onReveal }: DocumentLinksDialogProps) {
  const links = useDocumentFileLinks(storeId, path)
  const locations = links.data?.locations ?? []
  const grouped = locations.some((l) => l.grouped && !l.self)

  return (
    <BaseModal
      isOpen={path !== null}
      onClose={onClose}
      title="Where else this appears"
      maxWidth="lg"
      footer={
        <div className="flex justify-end">
          <button type="button" className="qt-button-primary qt-button-sm" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <p className="qt-text-xs qt-text-secondary mb-3">
        {grouped
          ? 'Hard-linked copies are one file: an edit through any of them reaches all. The others merely share identical contents and part ways at the next edit.'
          : 'These share identical contents only; each goes its own way at its next edit.'}
      </p>
      {links.isLoading ? (
        <div className="text-sm qt-text-secondary">Consulting the ledger…</div>
      ) : links.error ? (
        <div className="text-sm qt-text-destructive">{apiErrorMessage(links.error, 'The locations would not load')}</div>
      ) : (
        <ul className="space-y-1" data-testid="document-links-list">
          {locations.map((loc) => (
            <li key={loc.linkId} className="qt-card py-2 px-3 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm qt-text truncate" title={loc.relativePath}>
                  {loc.relativePath}
                </div>
                <div className="qt-text-xs qt-text-secondary truncate">{loc.mountPointName}</div>
              </div>
              {loc.self && <span className="qt-badge-disabled">This one</span>}
              {loc.grouped && !loc.self && <span className="qt-badge-info">Hard-linked</span>}
              {!loc.self && (
                <button
                  type="button"
                  className="qt-button-secondary qt-button-sm"
                  onClick={() => {
                    onClose()
                    onReveal(loc)
                  }}
                >
                  Go there
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </BaseModal>
  )
}

export interface DocumentDescriptionDialogProps {
  /** The file being described; null closes the dialog. */
  file: { relativePath: string; fileName: string; description: string } | null
  onClose: () => void
  onSave: (description: string) => Promise<boolean>
}

export function DocumentDescriptionDialog({ file, onClose, onSave }: DocumentDescriptionDialogProps) {
  return (
    <BaseModal isOpen={file !== null} onClose={onClose} title={`Describe ${file?.fileName ?? ''}`} maxWidth="lg">
      {file && <DescriptionForm key={file.relativePath} initial={file.description} onClose={onClose} onSave={onSave} />}
    </BaseModal>
  )
}

function DescriptionForm({
  initial,
  onClose,
  onSave,
}: {
  initial: string
  onClose: () => void
  onSave: (description: string) => Promise<boolean>
}) {
  const [text, setText] = useState(initial)
  const [saving, setSaving] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="document-description" className="qt-label">
        Description or transcript (searchable)
      </label>
      <textarea
        id="document-description"
        className="qt-input text-sm"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <button type="button" className="qt-button-secondary qt-button-sm" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className="qt-button-primary qt-button-sm"
          disabled={saving || text === initial}
          onClick={async () => {
            setSaving(true)
            const ok = await onSave(text)
            setSaving(false)
            if (ok) onClose()
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
