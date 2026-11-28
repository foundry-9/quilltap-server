'use client'

/**
 * DeleteConfirmPopover Component
 *
 * A confirmation popover for delete actions positioned absolutely.
 * The caller manages positioning with a relative parent.
 *
 * Accessible as a small dialog: Cancel takes focus on open, Escape closes it,
 * and focus returns to whatever held it before (the Delete toggle).
 */

import { useEffect, useRef } from 'react'

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
  /** Id for the popover, so the toggle can point at it with aria-controls */
  id?: string
}

export function DeleteConfirmPopover({
  isOpen,
  onCancel,
  onConfirm,
  message = 'Delete this item?',
  isDeleting = false,
  id,
}: DeleteConfirmPopoverProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    if (!isOpen) return
    const opener = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancelRef.current()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (opener && opener.isConnected) opener.focus()
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  return (
    <div className="absolute top-0 left-0 z-50">
      <div
        id={id}
        role="dialog"
        aria-label={message}
        className="qt-popover mt-2 min-w-48"
      >
        <p className="text-sm qt-text mb-4">
          {message}
        </p>
        <div className="flex gap-2 justify-end">
          <button
            ref={cancelRef}
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
