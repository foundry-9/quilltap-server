'use client'

import { BaseModal } from '@/components/ui/BaseModal'

interface WardrobeModeChangePromptProps {
  /** How many components will be discarded by switching to a single garment. */
  componentCount: number
  onCancel: () => void
  onReset: () => void
  onKeepTypes: () => void
}

/**
 * Confirmation prompt shown when switching a bundle with components back to a
 * single garment: the components are discarded, and the user chooses whether to
 * keep the types they were computing or reset them.
 */
export function WardrobeModeChangePrompt({
  componentCount,
  onCancel,
  onReset,
  onKeepTypes,
}: WardrobeModeChangePromptProps) {
  return (
    <BaseModal
      isOpen
      onClose={onCancel}
      role="alertdialog"
      title="Switch to a single garment?"
      maxWidth="md"
      footerClassName="qt-dialog-footer flex flex-wrap gap-2 justify-end"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="qt-button-ghost"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onReset}
            className="qt-button-secondary"
          >
            Reset types
          </button>
          <button
            type="button"
            onClick={onKeepTypes}
            className="qt-button-primary"
          >
            Keep types
          </button>
        </>
      }
    >
      <p className="qt-text-small">
        This will discard the {componentCount} component
        {componentCount === 1 ? '' : 's'}. Keep types as they are
        now, or reset?
      </p>
    </BaseModal>
  )
}
