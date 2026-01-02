'use client'

/**
 * Memory Cascade Confirmation Dialog
 *
 * Shows a confirmation dialog when deleting a message that has associated memories.
 * Allows user to choose what to do with the memories (delete, keep, or regenerate)
 * and optionally remember the choice for future deletions.
 */

import { useState } from 'react'
import type { MemoryCascadeAction } from '@/lib/schemas/settings.types'

export type { MemoryCascadeAction }

interface MemoryCascadeDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** Number of memories associated with the message */
  memoryCount: number
  /** Whether the message is part of a swipe group */
  isSwipeGroup: boolean
  /** Number of swipes in the group (if applicable) */
  swipeCount?: number
  /** Called when the dialog is cancelled */
  onClose: () => void
  /** Called when the user confirms with their chosen action */
  onConfirm: (action: MemoryCascadeAction, rememberChoice: boolean) => void
}

export function MemoryCascadeDialog({
  isOpen,
  memoryCount,
  isSwipeGroup,
  swipeCount = 1,
  onClose,
  onConfirm,
}: MemoryCascadeDialogProps) {
  const [rememberChoice, setRememberChoice] = useState(false)
  const [selectedAction, setSelectedAction] = useState<MemoryCascadeAction>('DELETE_MEMORIES')

  if (!isOpen) return null

  const messageText = isSwipeGroup
    ? `This message has ${swipeCount} swipes with a total of ${memoryCount} associated ${memoryCount === 1 ? 'memory' : 'memories'}.`
    : `This message has ${memoryCount} associated ${memoryCount === 1 ? 'memory' : 'memories'}.`

  const handleConfirm = () => {
    onConfirm(selectedAction, rememberChoice)
  }

  return (
    <div className="qt-dialog-overlay z-[100]">
      <div className="qt-dialog-content max-w-md">
        <h3 className="qt-heading-sm mb-4">Delete Message</h3>

        <p className="qt-text-small mb-4">{messageText}</p>

        <p className="qt-text-small mb-4">What would you like to do with the memories?</p>

        <div className="space-y-2 mb-4">
          <label className="flex items-start gap-3 cursor-pointer p-2 rounded-lg hover:bg-accent/50 transition-colors">
            <input
              type="radio"
              name="cascadeAction"
              value="DELETE_MEMORIES"
              checked={selectedAction === 'DELETE_MEMORIES'}
              onChange={() => setSelectedAction('DELETE_MEMORIES')}
              className="mt-0.5"
            />
            <div>
              <span className="qt-text-small font-medium">Delete memories too</span>
              <p className="qt-text-xs text-muted-foreground mt-0.5">
                Permanently remove associated memories
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer p-2 rounded-lg hover:bg-accent/50 transition-colors">
            <input
              type="radio"
              name="cascadeAction"
              value="KEEP_MEMORIES"
              checked={selectedAction === 'KEEP_MEMORIES'}
              onChange={() => setSelectedAction('KEEP_MEMORIES')}
              className="mt-0.5"
            />
            <div>
              <span className="qt-text-small font-medium">Keep memories</span>
              <p className="qt-text-xs text-muted-foreground mt-0.5">
                Memories will be orphaned (no link to source message)
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer p-2 rounded-lg hover:bg-accent/50 transition-colors">
            <input
              type="radio"
              name="cascadeAction"
              value="REGENERATE_MEMORIES"
              checked={selectedAction === 'REGENERATE_MEMORIES'}
              onChange={() => setSelectedAction('REGENERATE_MEMORIES')}
              className="mt-0.5"
            />
            <div>
              <span className="qt-text-small font-medium">Delete and regenerate</span>
              <p className="qt-text-xs text-muted-foreground mt-0.5">
                Delete old memories and extract new ones from conversation context
              </p>
            </div>
          </label>
        </div>

        <label className="flex items-center gap-2 cursor-pointer mb-6 p-2 rounded-lg hover:bg-accent/50 transition-colors">
          <input
            type="checkbox"
            checked={rememberChoice}
            onChange={(e) => setRememberChoice(e.target.checked)}
          />
          <span className="qt-text-xs text-muted-foreground">
            Remember this choice (can be changed in Settings)
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="qt-button-secondary qt-button-sm">
            Cancel
          </button>
          <button onClick={handleConfirm} className="qt-button-destructive qt-button-sm">
            Delete Message
          </button>
        </div>
      </div>
    </div>
  )
}

export default MemoryCascadeDialog
