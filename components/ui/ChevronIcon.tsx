/**
 * Shared chevron/disclosure icon component
 *
 * A downward-pointing chevron that rotates 180 degrees when expanded/rotated.
 * Used for collapsible sections, cards, and disclosure toggles throughout the app.
 *
 * @module components/ui/ChevronIcon
 */

interface ChevronIconProps {
  className?: string
  /** Whether the chevron should be rotated (expanded state) */
  expanded?: boolean
  /** Alias for expanded — used by sidebar sections */
  rotated?: boolean
}

export function ChevronIcon({ className, expanded, rotated }: ChevronIconProps) {
  const isRotated = expanded || rotated
  return (
    <svg
      className={`${className || ''} transition-transform duration-200 ${isRotated ? 'rotate-180' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
