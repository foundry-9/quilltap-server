'use client'

import { BaseModal, ModalTitle } from '@/components/ui/BaseModal'

/**
 * Delete Project Dialog
 *
 * Confirmation dialog for deleting a project.
 */

interface DeleteProjectDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
}

export function DeleteProjectDialog({ open, onClose, onConfirm }: DeleteProjectDialogProps) {
  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      role="alertdialog"
      headerless
      maxWidth="md"
      className="rounded-2xl border qt-border-default qt-bg-card shadow-2xl"
      bodyClassName="p-6 overflow-y-auto"
      overlayClassName="p-4"
    >
      <ModalTitle className="mb-4 qt-heading-4 text-foreground">Delete Project</ModalTitle>
      <p className="mb-4 qt-text-small">
        Are you sure you want to delete this project? Chats and files will be disassociated but not deleted.
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
          className="inline-flex items-center rounded-lg qt-bg-destructive px-4 py-2 text-sm font-semibold qt-text-on-destructive shadow hover:qt-bg-destructive/90"
        >
          Delete
        </button>
      </div>
    </BaseModal>
  )
}
