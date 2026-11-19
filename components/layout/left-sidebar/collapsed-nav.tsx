'use client'

/**
 * Collapsed Navigation
 *
 * The top of the rail, drawn from the navigation registry
 * (`lib/navigation/registry.ts`): the plain buttons (Home, Characters) and the
 * four group buttons, each opening its flyout (`nav-flyout.tsx`).
 *
 * @module components/layout/left-sidebar/collapsed-nav
 */

import type { KeyboardEvent, MouseEvent } from 'react'
import { usePathname } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { parseHrefToIntent } from '@/lib/navigation/route-to-intent'
import { NAV_GROUPS, NAV_TOP, navItemTabKinds, type NavItem, type NavItemId } from '@/lib/navigation/registry'
import type { TabKind } from '@/lib/workspace/types'
import { useNavRail } from './nav-rail-context'
import { navFlyoutId } from './nav-flyout'

/**
 * The kind of the surface on show: the focused pane's active tab inside the
 * workspace, else the tab kind the current route maps to. Null when nothing
 * maps.
 */
export function useCurrentTabKind(): TabKind | null {
  const ws = useWorkspaceOptional()
  const pathname = usePathname()
  if (ws && pathname === '/workspace') {
    const pane = ws.state.focusedPane === 'right' && ws.state.panes.right ? ws.state.panes.right : ws.state.panes.left
    const activeId = pane.activeTabId
    return activeId ? ws.state.tabs[activeId]?.kind ?? null : null
  }
  return pathname ? parseHrefToIntent(pathname)?.kind ?? null : null
}

/** A plain link's click: the browser keeps modifier- and middle-clicks (new tab). */
export function isPlainClick(event: MouseEvent): boolean {
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
}

export function CollapsedNav() {
  const { activate, openMenu, toggleFlyout, openFlyout } = useNavRail()
  // The button for the surface on show carries aria-current="page" — the
  // rail's only active indication, for assistive tech and themes alike. A
  // group is current when one of its rows is.
  const currentKind = useCurrentTabKind()
  const currentFor = (kinds: readonly TabKind[]) =>
    currentKind && kinds.includes(currentKind) ? ('page' as const) : undefined

  const onPlainClick = (item: NavItem<NavItemId>) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return
    event.preventDefault()
    activate(item.id)
  }

  const onGroupKeyDown = (groupId: (typeof NAV_GROUPS)[number]['id']) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      openFlyout(groupId, groupId, { focusFirst: true })
    }
  }

  return (
    <nav className="qt-collapsed-nav" aria-label="Quick navigation">
      {NAV_TOP.map((item) => (
        <a
          key={item.id}
          href={item.target.href}
          onClick={onPlainClick(item)}
          className="qt-collapsed-nav-button"
          data-nav={item.id}
          aria-current={currentFor(navItemTabKinds(item))}
          title={item.label}
          aria-label={item.label}
        >
          <Icon name={item.icon} className={item.id === 'home' ? 'w-8 h-8' : 'w-7 h-7'} />
        </a>
      ))}
      {NAV_GROUPS.map((group) => {
        const isOpen = openMenu?.id === group.id
        const kinds = group.items.flatMap((item) => navItemTabKinds(item))
        return (
          <button
            key={group.id}
            type="button"
            onClick={() => toggleFlyout(group.id, group.id)}
            onKeyDown={onGroupKeyDown(group.id)}
            className="qt-collapsed-nav-button"
            data-nav={group.id}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            aria-controls={isOpen ? navFlyoutId(group.id) : undefined}
            aria-current={currentFor(kinds)}
            title={group.label}
            aria-label={group.label}
          >
            <Icon name={group.icon} className="w-7 h-7" />
          </button>
        )
      })}
    </nav>
  )
}
