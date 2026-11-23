'use client'

/**
 * Left Sidebar
 *
 * The rail, drawn from the navigation registry (`lib/navigation/registry.ts`):
 * Home and Characters, the four group menus, then the pinned Help,
 * Quick-hide, Settings and profile buttons. `NavRailProvider` holds which
 * flyout is open and registers the Electron shell's native-menu handler.
 *
 * @module components/layout/left-sidebar
 */

import { SidebarFooter } from './sidebar-footer'
import { CollapsedNav } from './collapsed-nav'
import { NavFlyout } from './nav-flyout'
import { NavRailProvider } from './nav-rail-context'

export function LeftSidebar() {
  return (
    <NavRailProvider>
      <aside className="qt-left-sidebar qt-left-sidebar-collapsed" aria-label="Main navigation">
        <div className="qt-left-sidebar-content">
          <CollapsedNav />
        </div>

        <SidebarFooter />
      </aside>
      <NavFlyout />
    </NavRailProvider>
  )
}
