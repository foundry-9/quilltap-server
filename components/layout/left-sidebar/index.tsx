'use client'

/**
 * Left Sidebar
 *
 * Main app navigation sidebar with characters, chats, and actions.
 *
 * @module components/layout/left-sidebar
 */

import { useEffect } from 'react'
import { useSidebar } from '@/components/providers/sidebar-provider'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { SidebarHeader } from './sidebar-header'
import { SidebarSection } from './sidebar-section'
import { SidebarFooter } from './sidebar-footer'
import { ProjectsSection } from './projects-section'
import { FilesSection } from './files-section'
import { CharactersSection } from './characters-section'
import { ChatsSection } from './chats-section'
import { clientLogger } from '@/lib/client-logger'

/**
 * Folder icon (for Projects)
 */
function FolderIcon({ className }: { className?: string }) {
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
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}


export function LeftSidebar() {
  const { isCollapsed, isMobileOpen, closeMobile, isMobile, width } = useSidebar()
  const { handleRef, isResizing, startResize } = useSidebarResize()

  useEffect(() => {
    clientLogger.debug('LeftSidebar mounted', { isCollapsed, isMobile, width })
  }, [isCollapsed, isMobile, width])

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
