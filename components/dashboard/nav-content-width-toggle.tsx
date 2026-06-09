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
import { Icon } from '@/components/ui/icon'

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
        <Icon name="compress" className="w-5 h-5" />
      ) : (
        <Icon name="expand" className="w-5 h-5" />
      )}
    </button>
  )
}
