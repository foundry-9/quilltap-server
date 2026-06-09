'use client'

/**
 * Left Sidebar
 *
 * Main app navigation sidebar, always in collapsed state.
 *
 * @module components/layout/left-sidebar
 */

import { SidebarFooter } from './sidebar-footer'
import { CollapsedNav } from './collapsed-nav'

// Note: the sidebar is always collapsed and CollapsedNav already provides the
// quill Home/brand link as its first item, so there is no separate header.

export function LeftSidebar() {
  return (
    <aside className="qt-left-sidebar qt-left-sidebar-collapsed" aria-label="Main navigation">
      <div className="qt-left-sidebar-content">
        <CollapsedNav />
      </div>

      <SidebarFooter />
    </aside>
  )
}

