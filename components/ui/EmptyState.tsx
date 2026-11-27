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
        return `${baseClasses} border border-dashed qt-border-default bg-transparent`
      case 'muted':
        return `${baseClasses} qt-bg-muted/50`
      case 'default':
      default:
        return `${baseClasses} qt-bg-muted border qt-border-default`
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

/**
 * The large dashed card a list page shows when it has nothing to list (no
 * projects, no chats, no photos yet). The caller supplies the words and the
 * call to action; the panel is the frame they sit in.
 */
export function EmptyStatePanel({
  className,
  spacious = false,
  children,
}: {
  /** Extra classes, e.g. a theme hook such as `chat-empty-state` */
  className?: string
  /** Taller padding (`py-16` rather than `py-12`) */
  spacious?: boolean
  children: React.ReactNode
}) {
  const padding = spacious ? 'py-16' : 'py-12'
  const base = `mt-12 rounded-2xl border border-dashed qt-border-default/70 qt-bg-card/80 px-8 ${padding} text-center qt-shadow-sm`
  return <div className={className ? `${className} ${base}` : base}>{children}</div>
}

export default EmptyState
