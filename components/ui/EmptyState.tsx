'use client'

/**
 * EmptyState Component
 *
 * A flexible empty state component with icon, title, description, and optional action.
 * Supports multiple variants for different visual presentations.
 */

export interface EmptyStateProps {
  /** Optional icon or React node */
  icon?: React.ReactNode
  /** Title text */
  title: string
  /** Optional description text */
  description?: string
  /** Optional action button */
  action?: {
    label: string
    onClick: () => void
  }
  /** Visual variant */
  variant?: 'default' | 'dashed' | 'muted'
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'default',
}: EmptyStateProps) {
  const getContainerClasses = () => {
    const baseClasses = 'qt-empty-state rounded-lg'

    switch (variant) {
      case 'dashed':
        return `${baseClasses} border border-dashed border-border bg-transparent`
      case 'muted':
        return `${baseClasses} bg-muted/50`
      case 'default':
      default:
        return `${baseClasses} bg-muted border border-border`
    }
  }

  return (
    <div className={getContainerClasses()}>
      {icon && (
        <div className="qt-empty-state-icon">
          {icon}
        </div>
      )}
      <h3 className="qt-empty-state-title">
        {title}
      </h3>
      {description && (
        <p className="qt-empty-state-description">
          {description}
        </p>
      )}
      {action && (
        <div className="qt-empty-state-action">
          <button
            type="button"
            onClick={action.onClick}
            className="qt-button-primary qt-button-sm"
          >
            {action.label}
          </button>
        </div>
      )}
    </div>
  )
}

export default EmptyState
