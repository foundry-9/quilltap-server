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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border qt-border-default qt-bg-card p-6 shadow-2xl">
        <h3 className="mb-4 text-lg font-semibold text-foreground">Delete Document Store</h3>
        <p className="mb-4 qt-text-small">
          Are you sure you want to delete this document store? All indexed files, text chunks, and embeddings will be permanently removed. The original files on disk will not be affected.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm qt-text-primary qt-shadow-sm hover:qt-bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="inline-flex items-center rounded-lg bg-destructive px-4 py-2 text-sm font-semibold qt-text-destructive-foreground shadow hover:qt-bg-destructive/90"
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
