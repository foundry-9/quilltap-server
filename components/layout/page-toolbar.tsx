'use client'

/**
 * Page Toolbar
 *
 * Top toolbar for pages with centered search bar and full-width toggle.
 * Replaces the app header in the new layout.
 *
 * @module components/layout/page-toolbar
 */

import { useEffect } from 'react'
import { SearchBar } from '@/components/search/search-bar'
import { NavContentWidthToggle } from '@/components/dashboard/nav-content-width-toggle'
import { useSidebarOptional } from '@/components/providers/sidebar-provider'
import { usePageToolbarOptional } from '@/components/providers/page-toolbar-provider'
import { clientLogger } from '@/lib/client-logger'

/**
 * Hamburger menu icon
 */
function HamburgerIcon({ className }: { className?: string }) {
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
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

export function PageToolbar() {
  const sidebar = useSidebarOptional()
  const pageToolbar = usePageToolbarOptional()

  useEffect(() => {
    clientLogger.debug('PageToolbar mounted')
  }, [])

  const handleHamburgerClick = () => {
    if (sidebar) {
      sidebar.openMobile()
      clientLogger.debug('Hamburger menu clicked, opening mobile sidebar')
    }
  }

  return (
    <div className="qt-page-toolbar">
      {/* Left section: hamburger (mobile only) + page-specific content */}
      <div className="qt-page-toolbar-left">
        <button
          type="button"
          onClick={handleHamburgerClick}
          className="qt-hamburger"
          aria-label="Open menu"
        >
          <HamburgerIcon className="w-6 h-6" />
        </button>
        {/* Page-specific left content (e.g., project link in chat) */}
        {pageToolbar?.leftContent}
      </div>

      {/* Center section: search bar */}
      <div className="qt-page-toolbar-center">
        <SearchBar />
      </div>

      {/* Right section: full-width toggle */}
      <div className="qt-page-toolbar-right">
        <NavContentWidthToggle />
      </div>
    </div>
  )
}
