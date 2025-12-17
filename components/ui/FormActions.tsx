'use client'

/**
 * FormActions Component
 *
 * A standard form actions footer with cancel and submit buttons.
 */

export interface FormActionsProps {
  /** Called when cancel button is clicked */
  onCancel: () => void
  /** Called when submit button is clicked */
  onSubmit?: () => void
  /** Label for submit button (defaults to 'Save') */
  submitLabel?: string
  /** Label for cancel button (defaults to 'Cancel') */
  cancelLabel?: string
  /** Whether a submit operation is in progress */
  isLoading?: boolean
  /** Whether buttons are disabled */
  isDisabled?: boolean
  /** Button type - affects form submission behavior */
  type?: 'button' | 'submit'
}

export function FormActions({
  onCancel,
  onSubmit,
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  isLoading = false,
  isDisabled = false,
  type = 'button',
}: FormActionsProps) {
  const isButtonDisabled = isDisabled || isLoading

  return (
    <div className="flex gap-2 justify-end">
      <button
        type="button"
        onClick={onCancel}
        disabled={isButtonDisabled}
        className="qt-button-secondary"
      >
        {cancelLabel}
      </button>
      {onSubmit && (
        <button
          type={type}
          onClick={onSubmit}
          disabled={isButtonDisabled}
          className="qt-button-primary"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <span className="qt-spinner-sm" />
              {submitLabel}
            </span>
          ) : (
            submitLabel
          )}
        </button>
      )}
    </div>
  )
}

export default FormActions
