'use client'

/**
 * ErrorAlert Component
 *
 * An error alert with optional retry button.
 */

export interface ErrorAlertProps {
  /** Error message to display */
  message: string
  /** Optional retry handler */
  onRetry?: () => void
  /** Optional CSS class to apply to the container */
  className?: string
}

export function ErrorAlert({
  message,
  onRetry,
  className = '',
}: ErrorAlertProps) {
  return (
    <div className={`qt-alert-error ${className}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <p className="text-sm font-medium">{message}</p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="qt-button-ghost qt-button-sm flex-shrink-0"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  )
}

export default ErrorAlert
