'use client'

/**
 * Delete Document Store Dialog
 *
 * Confirmation dialog for deleting a document store.
 */

import { createPortal } from 'react-dom'

interface DeleteDocumentStoreDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
}

export function DeleteDocumentStoreDialog({ open, onClose, onConfirm }: DeleteDocumentStoreDialogProps) {
  if (!open) return null

  return createPortal(
    <div className="qt-dialog-overlay p-4">
      <div className="qt-dialog max-w-md p-6">
        <h3 className="qt-dialog-title mb-4">Delete Document Store</h3>
        <p className="mb-4 qt-text-small">
          Are you sure you want to delete this document store? All indexed files, text chunks, and embeddings will be permanently removed. The original files on disk will not be affected.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="qt-button-secondary"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="qt-button-destructive"
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
