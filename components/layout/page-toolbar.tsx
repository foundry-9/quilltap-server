'use client'

/**
 * Page Toolbar
 *
 * Top toolbar for pages with centered search bar and full-width toggle.
 * Replaces the app header in the new layout.
 *
 * @module components/layout/page-toolbar
 */

import { SearchBar } from '@/components/search/search-bar'
import { NavContentWidthToggle } from '@/components/dashboard/nav-content-width-toggle'
import { usePageToolbarOptional } from '@/components/providers/page-toolbar-provider'

export function PageToolbar() {
  const pageToolbar = usePageToolbarOptional()

  return (
    <div className="qt-page-toolbar">
      {/* Left section: page-specific content */}
      <div className="qt-page-toolbar-left">
        {/* Page-specific left content (e.g., project link in chat) */}
        {pageToolbar?.leftContent}
      </div>

      {/* Center section: search bar */}
      <div className="qt-page-toolbar-center">
        <SearchBar />
      </div>

      {/* Right section: page-specific content + full-width toggle */}
      <div className="qt-page-toolbar-right">
        {pageToolbar?.rightContent}
        <NavContentWidthToggle />
      </div>
    </div>
  )
}
