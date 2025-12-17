'use client'

/**
 * DeleteConfirmPopover Component
 *
 * A confirmation popover for delete actions positioned absolutely.
 * The caller manages positioning with a relative parent.
 */

export interface DeleteConfirmPopoverProps {
  /** Whether the popover is open */
  isOpen: boolean
  /** Called when cancel button is clicked */
  onCancel: () => void
  /** Called when confirm button is clicked */
  onConfirm: () => void
  /** Message to display (defaults to "Delete this item?") */
  message?: string
  /** Whether a delete operation is in progress */
  isDeleting?: boolean
}

export function DeleteConfirmPopover({
  isOpen,
  onCancel,
  onConfirm,
  message = 'Delete this item?',
  isDeleting = false,
}: DeleteConfirmPopoverProps) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="absolute top-0 left-0 z-50">
      <div className="qt-popover mt-2 min-w-48">
        <p className="text-sm text-foreground mb-4">
          {message}
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="qt-button-secondary qt-button-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="qt-button-destructive qt-button-sm"
          >
            {isDeleting ? (
              <span className="flex items-center gap-2">
                <span className="qt-spinner-sm" />
                Deleting...
              </span>
            ) : (
              'Delete'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default DeleteConfirmPopover
