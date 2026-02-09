'use client'

/**
 * Left Sidebar
 *
 * Main app navigation sidebar, always in collapsed state.
 *
 * @module components/layout/left-sidebar
 */

import { SidebarHeader } from './sidebar-header'
import { SidebarFooter } from './sidebar-footer'
import { CollapsedNav } from './collapsed-nav'


export function LeftSidebar() {
  return (
    <aside className="qt-left-sidebar qt-left-sidebar-collapsed" aria-label="Main navigation">
      <SidebarHeader />

      <div className="qt-left-sidebar-content">
        <CollapsedNav />
      </div>

      <SidebarFooter />
    </aside>
  )
}

// Re-export components for convenience
export { SidebarSection } from './sidebar-section'
export { SidebarItem, ViewAllLink } from './sidebar-item'
export { SidebarHeader } from './sidebar-header'
export { SidebarFooter } from './sidebar-footer'
export { CollapsedNav } from './collapsed-nav'
