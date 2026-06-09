'use client'

/**
 * Collapsed Navigation
 *
 * Navigation links shown in the always-collapsed sidebar.
 * Each item is a direct Link to the corresponding view-all page.
 *
 * @module components/layout/left-sidebar/collapsed-nav
 */

import { Icon } from '@/components/ui/icon'
import type { IconName } from '@/components/ui/icons/icon-registry'

interface NavItem {
  id: string
  label: string
  tooltip: string
  href: string
  icon: IconName
}

const navItems: NavItem[] = [
  { id: 'projects', label: 'Projects', tooltip: 'View all projects', href: '/prospero', icon: 'projects' },
  { id: 'files', label: 'Files', tooltip: 'View all files', href: '/files', icon: 'files' },
  { id: 'scriptorium', label: 'The Scriptorium', tooltip: 'View document stores', href: '/scriptorium', icon: 'scriptorium' },
  { id: 'characters', label: 'Characters', tooltip: 'View all characters', href: '/aurora', icon: 'characters' },
  { id: 'photos', label: 'My Photos', tooltip: "Your saved photo gallery", href: '/photos', icon: 'photos' },
  { id: 'scenarios', label: 'Scenarios', tooltip: 'Manage general scenarios', href: '/scenarios', icon: 'scenarios' },
  { id: 'chats', label: 'Chats', tooltip: 'View all chats', href: '/salon', icon: 'chat' },
]

export function CollapsedNav() {
  return (
    <nav className="qt-collapsed-nav" aria-label="Quick navigation">
      {/* Plain <a> tags — no onClick/router.push/Link to avoid startTransition stall on chat page */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="qt-collapsed-nav-button"
        title="Home"
        aria-label="Home"
      >
        <Icon name="brand" className="w-7 h-7" />
      </a>
      {navItems.map((item) => (
        <a
          key={item.id}
          href={item.href}
          className="qt-collapsed-nav-button"
          title={item.tooltip}
          aria-label={item.tooltip}
        >
          <Icon name={item.icon} className="w-5 h-5" />
        </a>
      ))}
    </nav>
  )
}
