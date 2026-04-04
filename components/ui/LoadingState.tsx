'use client'

/**
 * LoadingState Component
 *
 * A flexible loading indicator with multiple variants.
 */

export interface LoadingStateProps {
  /** Optional message text */
  message?: string
  /** Variant type */
  variant?: 'spinner' | 'text' | 'dots'
  /** Optional CSS class to apply to the container */
  className?: string
}

export function LoadingState({
  message = 'Loading...',
  variant = 'spinner',
  className = '',
}: LoadingStateProps) {
  const getContent = () => {
    switch (variant) {
      case 'text':
        return <p className="text-sm qt-text-secondary">{message}</p>

      case 'dots': {
        // Create animated dots effect
        const style = `
          @keyframes dots {
            0%, 20% { content: '.'; }
            40% { content: '..'; }
            60%, 100% { content: '...'; }
          }
        `
        return (
          <div>
            <style>{style}</style>
            <p className="text-sm qt-text-secondary">
              {message}
              <span className="inline-block" style={{ minWidth: '0.75rem' }}>
                <span className="animate-bounce" style={{ animationDelay: '0s' }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: '0.1s' }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>.</span>
              </span>
            </p>
          </div>
        )
      }

      case 'spinner':
      default:
        return (
          <div className="flex flex-col items-center gap-3">
            <div className="qt-spinner text-primary" />
            {message && <p className="text-sm qt-text-secondary">{message}</p>}
          </div>
        )
    }
  }

  return (
    <div className={`flex items-center justify-center py-8 ${className}`}>
      {getContent()}
    </div>
  )
}

export default LoadingState
