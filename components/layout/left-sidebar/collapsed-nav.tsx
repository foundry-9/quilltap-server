'use client'

/**
 * Collapsed Navigation
 *
 * Navigation links shown in the always-collapsed sidebar.
 * Each item is a direct Link to the corresponding view-all page.
 *
 * @module components/layout/left-sidebar/collapsed-nav
 */

import { usePathname } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import type { IconName } from '@/components/ui/icons/icon-registry'
import { useWorkspaceLink } from '@/components/workspace/useWorkspaceLink'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { parseHrefToIntent } from '@/lib/navigation/route-to-intent'
import type { TabKind } from '@/lib/workspace/types'
import type { SidebarNavId } from '@/lib/themes/hooks/sidebar'

interface NavItem {
  /** Stable id, written as `data-nav` (theme hook catalogue: lib/themes/hooks/sidebar.ts). */
  id: SidebarNavId
  label: string
  tooltip: string
  href: string
  icon: IconName
  /** Tab kinds this item stands for: when the focused pane shows one, the item is current. */
  tabKinds: readonly TabKind[]
}

const HOME_TAB_KINDS: readonly TabKind[] = ['home']

const navItems: NavItem[] = [
  { id: 'projects', label: 'Projects', tooltip: 'View all projects', href: '/prospero', icon: 'projects', tabKinds: ['prospero'] },
  { id: 'files', label: 'Files', tooltip: 'View all files', href: '/files', icon: 'files', tabKinds: ['files'] },
  { id: 'scriptorium', label: 'The Scriptorium', tooltip: 'View document stores', href: '/scriptorium', icon: 'scriptorium', tabKinds: ['scriptorium'] },
  { id: 'characters', label: 'Characters', tooltip: 'View all characters', href: '/aurora', icon: 'characters', tabKinds: ['aurora', 'character', 'character-new'] },
  { id: 'photos', label: 'My Photos', tooltip: "Your saved photo gallery", href: '/photos', icon: 'photos', tabKinds: ['photos'] },
  { id: 'scenarios', label: 'Scenarios', tooltip: 'Manage general scenarios', href: '/scenarios', icon: 'scenarios', tabKinds: ['scenarios'] },
  { id: 'custom-tools', label: "Pascal's Workbench", tooltip: 'Build and prove custom tools', href: '/custom-tools', icon: 'wrench', tabKinds: ['custom-tools'] },
  { id: 'chats', label: 'Chats', tooltip: 'View all chats', href: '/salon', icon: 'chat', tabKinds: ['salon-list', 'salon'] },
]

/**
 * The kind of the surface on show: the focused pane's active tab inside the
 * workspace, else the tab kind the current route maps to (the legacy shell).
 * Null when nothing maps.
 */
function useCurrentTabKind(): TabKind | null {
  const ws = useWorkspaceOptional()
  const pathname = usePathname()
  if (ws && pathname === '/workspace') {
    const pane = ws.state.focusedPane === 'right' && ws.state.panes.right ? ws.state.panes.right : ws.state.panes.left
    const activeId = pane.activeTabId
    return activeId ? ws.state.tabs[activeId]?.kind ?? null : null
  }
  return pathname ? parseHrefToIntent(pathname)?.kind ?? null : null
}

export function CollapsedNav() {
  // Inside the tabbed workspace, a rail click opens/focuses a tab in the focused
  // pane instead of navigating (which would unmount the workspace). On the
  // legacy shell there is no workspace store, so the plain links navigate as
  // before. The `href` is kept for middle-click / open-in-new-tab and the
  // legacy path.
  const openInWorkspace = useWorkspaceLink()
  // The item for the surface on show carries aria-current="page" — the rail's
  // only active indication, for assistive tech and themes alike.
  const currentKind = useCurrentTabKind()
  const currentFor = (kinds: readonly TabKind[]) =>
    currentKind && kinds.includes(currentKind) ? ('page' as const) : undefined
  return (
    <nav className="qt-collapsed-nav" aria-label="Quick navigation">
      {/* Plain <a> tags — no Link/router.push to avoid startTransition stall on chat page */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- plain <a> on purpose: next/link navigation stalls in startTransition on the chat page */}
      <a
        href="/"
        onClick={(e) => openInWorkspace('/', e)}
        className="qt-collapsed-nav-button"
        data-nav="home"
        aria-current={currentFor(HOME_TAB_KINDS)}
        title="Home"
        aria-label="Home"
      >
        <Icon name="brand" className="w-8 h-8" />
      </a>
      {navItems.map((item) => (
        <a
          key={item.id}
          href={item.href}
          onClick={(e) => openInWorkspace(item.href, e)}
          className="qt-collapsed-nav-button"
          data-nav={item.id}
          aria-current={currentFor(item.tabKinds)}
          title={item.tooltip}
          aria-label={item.tooltip}
        >
          <Icon name={item.icon} className="w-7 h-7" />
        </a>
      ))}
    </nav>
  )
}
