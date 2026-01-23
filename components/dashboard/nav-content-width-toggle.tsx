'use client'

/**
 * Content Width Toggle Button
 *
 * A navbar button that toggles between narrow (800px) and wide (100%) content width.
 * Only visible when viewport is >= 1000px where wide mode would actually apply.
 *
 * @module components/dashboard/nav-content-width-toggle
 */

import { useContentWidthOptional } from '@/components/providers/content-width-provider'

/**
 * Expand icon - outward-pointing arrows (used when in narrow mode, click to expand)
 */
function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Left arrow pointing left */}
      <polyline points="15 3 21 3 21 9" />
      <line x1="21" y1="3" x2="14" y2="10" />
      {/* Right arrow pointing right */}
      <polyline points="9 21 3 21 3 15" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )
}

/**
 * Compress icon - inward-pointing arrows (used when in wide mode, click to compress)
 */
function CompressIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Arrow pointing inward from top-right */}
      <polyline points="4 14 10 14 10 20" />
      <line x1="3" y1="21" x2="10" y2="14" />
      {/* Arrow pointing inward from bottom-left */}
      <polyline points="20 10 14 10 14 4" />
      <line x1="21" y1="3" x2="14" y2="10" />
    </svg>
  )
}

export function NavContentWidthToggle() {
  const contentWidth = useContentWidthOptional()

  // Don't render if provider not available or viewport too narrow
  if (!contentWidth || !contentWidth.canApplyWide) {
    return null
  }

  const { isWide, toggleWidth } = contentWidth

  const handleClick = () => {
    toggleWidth()
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`qt-navbar-toggle ${isWide ? 'qt-navbar-toggle-active' : ''}`}
      title={isWide ? 'Switch to narrow layout' : 'Switch to wide layout'}
      aria-label={isWide ? 'Switch to narrow layout' : 'Switch to wide layout'}
      aria-pressed={isWide}
    >
      {isWide ? (
        <CompressIcon className="w-5 h-5" />
      ) : (
        <ExpandIcon className="w-5 h-5" />
      )}
    </button>
  )
}
