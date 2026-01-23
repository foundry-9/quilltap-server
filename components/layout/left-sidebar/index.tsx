'use client'

/**
 * Left Sidebar
 *
 * Main app navigation sidebar with characters, chats, and actions.
 *
 * @module components/layout/left-sidebar
 */

import { useSidebar } from '@/components/providers/sidebar-provider'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { SidebarHeader } from './sidebar-header'
import { SidebarFooter } from './sidebar-footer'
import { ProjectsSection } from './projects-section'
import { FilesSection } from './files-section'
import { CharactersSection } from './characters-section'
import { ChatsSection } from './chats-section'
import { CollapsedNav } from './collapsed-nav'


export function LeftSidebar() {
  const { isCollapsed, isMobileOpen, closeMobile, isMobile, width } = useSidebar()
  const { handleRef, isResizing, startResize } = useSidebarResize()

  // Build sidebar classes
  const sidebarClasses = [
    'qt-left-sidebar',
    isCollapsed && 'qt-left-sidebar-collapsed',
    isMobileOpen && 'qt-left-sidebar-mobile-open',
  ].filter(Boolean).join(' ')

  // Apply custom width when not collapsed and not on mobile
  const sidebarStyle = !isCollapsed && !isMobile ? { width: `${width}px` } : undefined

  return (
    <>
      {/* Mobile overlay backdrop */}
      {isMobile && (
        <div
          className={`qt-left-sidebar-overlay ${isMobileOpen ? 'qt-left-sidebar-overlay-visible' : ''}`}
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside className={sidebarClasses} style={sidebarStyle} aria-label="Main navigation">
        <SidebarHeader />

        {/* When collapsed (desktop only), show compact navigation buttons */}
        {isCollapsed && !isMobile ? (
          <div className="qt-left-sidebar-content">
            <CollapsedNav />
          </div>
        ) : (
          <div className="qt-left-sidebar-content">
            {/* Projects section */}
            <ProjectsSection />

            {/* Files section */}
            <FilesSection />

            {/* Characters section */}
            <CharactersSection />

            {/* Chats section - grows to fill remaining space */}
            <ChatsSection />
          </div>
        )}

        <SidebarFooter />

        {/* Resize handle */}
        <div
          ref={handleRef}
          className={`qt-left-sidebar-resize-handle ${isResizing ? 'qt-left-sidebar-resize-handle-active' : ''}`}
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
        />
      </aside>
    </>
  )
}

// Re-export components for convenience
export { SidebarSection } from './sidebar-section'
export { SidebarItem, ViewAllLink } from './sidebar-item'
export { SidebarHeader } from './sidebar-header'
export { SidebarFooter } from './sidebar-footer'
export { CollapsedNav } from './collapsed-nav'
