'use client'

/**
 * SectionHeader Component
 *
 * A header for sections with title, optional count, and optional action button.
 */

export interface SectionHeaderProps {
  /** Section title */
  title: string
  /** Optional count to display in parentheses */
  count?: number
  /** Optional action button */
  action?: {
    label: string
    onClick: () => void
    show?: boolean // defaults to true
  }
  /** HTML heading level */
  level?: 'h2' | 'h3'
}

export function SectionHeader({
  title,
  count,
  action,
  level = 'h3',
}: SectionHeaderProps) {
  const showAction = action?.show !== false

  const titleText = count !== undefined ? `${title} (${count})` : title

  return (
    <div className="flex items-center justify-between gap-4 mb-4">
      {level === 'h2' ? (
        <h2 className="qt-text-section text-foreground flex-1">
          {titleText}
        </h2>
      ) : (
        <h3 className="qt-text-section text-foreground flex-1">
          {titleText}
        </h3>
      )}
      {showAction && action && (
        <button
          type="button"
          onClick={action.onClick}
          className="qt-button-secondary qt-button-sm flex-shrink-0"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

export default SectionHeader
