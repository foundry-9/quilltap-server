'use client'

/**
 * Delete Document Store Dialog
 *
 * Confirmation dialog for deleting a document store.
 */

import { BaseModal, ModalTitle } from '@/components/ui/BaseModal'

interface DeleteDocumentStoreDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
}

export function DeleteDocumentStoreDialog({ open, onClose, onConfirm }: DeleteDocumentStoreDialogProps) {
  if (!open) return null

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      role="alertdialog"
      headerless
      maxWidth="md"
      className="p-6"
      bodyClassName="overflow-y-auto"
      overlayClassName="p-4"
    >
      <ModalTitle className="qt-dialog-title mb-4">Delete Document Store</ModalTitle>
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
    </BaseModal>
  )
}
