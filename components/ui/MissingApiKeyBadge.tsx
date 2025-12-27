/**
 * MissingApiKeyBadge Component
 *
 * Visual warning indicator for elements that require an API key but don't have one configured.
 * Uses the qt-badge-warning styling for consistent amber/yellow warning appearance.
 */

interface MissingApiKeyBadgeProps {
  /** Optional additional CSS classes */
  className?: string
  /** Optional custom message (defaults to "No API Key") */
  message?: string
}

/**
 * Displays a warning badge indicating a missing API key
 *
 * @example
 * ```tsx
 * // Basic usage
 * <MissingApiKeyBadge />
 *
 * // With custom class
 * <MissingApiKeyBadge className="ml-2" />
 *
 * // With custom message
 * <MissingApiKeyBadge message="Key Missing" />
 * ```
 */
export function MissingApiKeyBadge({
  className = '',
  message = 'No API Key',
}: MissingApiKeyBadgeProps) {
  return (
    <span className={`qt-badge-warning ${className}`.trim()}>
      ⚠️ {message}
    </span>
  )
}
