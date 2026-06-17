'use client'

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
    <>
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none z-[90]"
        onClick={onCancel}
        aria-label="Cancel"
        type="button"
      />
      <div
        className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[100] pointer-events-auto"
        style={{ width: 'min(420px, calc(100vw - 2rem))' }}
      >
        <div className="qt-dialog">
          <div className="qt-dialog-header">
            <h3 className="qt-dialog-title">Switch to a single garment?</h3>
          </div>
          <div className="qt-dialog-body">
            <p className="qt-text-small">
              This will discard the {componentCount} component
              {componentCount === 1 ? '' : 's'}. Keep types as they are
              now, or reset?
            </p>
          </div>
          <div className="qt-dialog-footer flex flex-wrap gap-2 justify-end">
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
          </div>
        </div>
      </div>
    </>
  )
}
