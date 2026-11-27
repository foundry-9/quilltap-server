'use client'

/**
 * LoadingState Component
 *
 * A centred spinner with an optional message beneath it.
 */

export interface LoadingStateProps {
  /** Optional message text */
  message?: string
  /** Optional CSS class to apply to the container */
  className?: string
}

export function LoadingState({
  message = 'Loading...',
  className = '',
}: LoadingStateProps) {
  return (
    <div className={`qt-loading-state ${className}`}>
      <div className="flex flex-col items-center gap-3">
        <div className="qt-spinner qt-text-brand" />
        {message && <p className="text-sm qt-text-secondary">{message}</p>}
      </div>
    </div>
  )
}

export default LoadingState
