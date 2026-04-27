'use client'

/**
 * Convert Document Store to Database Dialog
 *
 * Confirms moving a filesystem-backed document store's contents into the
 * encrypted quilltap-mount-index database. Warns about the image
 * transcoding caveat and reassures the user their source files aren't
 * touched.
 */

import { createPortal } from 'react-dom'
import type { DocumentStore } from '../types'

interface ConvertToDatabaseDialogProps {
  store: DocumentStore | null
  onClose: () => void
  onConfirm: () => void
}

export function ConvertToDatabaseDialog({ store, onClose, onConfirm }: ConvertToDatabaseDialogProps) {
  if (!store) return null

  return createPortal(
    <div className="qt-dialog-overlay p-4">
      <div className="qt-dialog max-w-lg p-6">
        <h3 className="qt-dialog-title mb-4">Convert &ldquo;{store.name}&rdquo; to Database-Backed Storage</h3>

        <div className="space-y-3 mb-5">
          <p className="qt-text-small">
            Every file currently indexed in this document store will be read from
            <code className="mx-1 rounded qt-bg-muted px-1.5 py-0.5 text-xs">{store.basePath}</code>
            and stored inside the encrypted mount-index database.
          </p>

          <ul className="list-disc pl-5 qt-text-small space-y-1">
            <li>Text files (<code>.md</code>, <code>.txt</code>) are stored as documents you can edit in-app.</li>
            <li>Binary files (<code>.pdf</code>, <code>.docx</code>, images) are stored as blobs.</li>
            <li><strong>Existing chunks and embeddings are preserved</strong> — no re-embedding required.</li>
            <li><strong>Your files on disk are left exactly where they are.</strong> You may delete them afterwards if you wish.</li>
          </ul>

          <div className="qt-callout">
            <p className="text-xs">
              <strong>Image caveat:</strong> images are transcoded to WebP on storage. A later Deconvert
              will round-trip them as <code>.webp</code>, not their original format.
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="qt-button-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="qt-button-primary"
          >
            Convert
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
