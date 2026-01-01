'use client'

/**
 * Sidebar Header
 *
 * Header area with collapse toggle button.
 *
 * @module components/layout/left-sidebar/sidebar-header
 */

import { useSidebar } from '@/components/providers/sidebar-provider'

/**
 * Chevron left icon (for collapsing)
 */
function ChevronLeftIcon({ className }: { className?: string }) {
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
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

/**
 * Chevron right icon (for expanding)
 */
function ChevronRightIcon({ className }: { className?: string }) {
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
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

/**
 * Menu icon (hamburger)
 */
function MenuIcon({ className }: { className?: string }) {
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
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

export function SidebarHeader() {
  const { isCollapsed, toggleCollapse } = useSidebar()

  return (
    <div className="qt-left-sidebar-header">
      <button
        type="button"
        onClick={toggleCollapse}
        className="qt-left-sidebar-toggle"
        title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!isCollapsed}
      >
        {isCollapsed ? (
          <MenuIcon className="w-5 h-5" />
        ) : (
          <ChevronLeftIcon className="w-5 h-5" />
        )}
      </button>
    </div>
  )
}
