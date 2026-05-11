'use client'

/**
 * Collapsed Navigation
 *
 * Navigation links shown in the always-collapsed sidebar.
 * Each item is a direct Link to the corresponding view-all page.
 *
 * @module components/layout/left-sidebar/collapsed-nav
 */

import Image from 'next/image'

/**
 * Prospero icon (compass and blueprint — overarching design)
 */
function ProsperoIcon({ className }: { className?: string }) {
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
      {/* Blueprint sheet */}
      <rect x="3" y="5" width="18" height="16" rx="1" />
      {/* Blueprint grid lines */}
      <line x1="3" y1="11" x2="21" y2="11" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="3" y1="15" x2="21" y2="15" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="9" y1="5" x2="9" y2="21" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="15" y1="5" x2="15" y2="21" strokeWidth="1" strokeOpacity="0.4" />
      {/* Drafting compass */}
      <circle cx="14" cy="3" r="1" strokeWidth="1.5" />
      <line x1="13.3" y1="3.8" x2="9" y2="13" />
      <line x1="14.7" y1="3.8" x2="19" y2="13" />
    </svg>
  )
}

/**
 * File icon (for Files)
 */
function FileIcon({ className }: { className?: string }) {
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
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

/**
 * Character icon (sculpted bust)
 */
function CharacterIcon({ className }: { className?: string }) {
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
      {/* Head */}
      <ellipse cx="12" cy="7" rx="4" ry="4.5" />
      {/* Neck */}
      <path d="M10 11.5v2h4v-2" />
      {/* Shoulders/chest */}
      <path d="M7 17c0-2 2-3.5 5-3.5s5 1.5 5 3.5" />
      {/* Pedestal */}
      <rect x="6" y="17" width="12" height="2" rx="0.5" />
      <rect x="8" y="19" width="8" height="2" rx="0.5" />
    </svg>
  )
}

/**
 * Scriptorium icon (unrolled scroll)
 */
function ScriptoriumIcon({ className }: { className?: string }) {
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
      {/* Top roll */}
      <path d="M8 3c0 1.1-.9 2-2 2H5a2 2 0 0 0 0 4h1" />
      {/* Bottom roll */}
      <path d="M16 21c0-1.1.9-2 2-2h1a2 2 0 0 0 0-4h-1" />
      {/* Scroll body */}
      <path d="M6 7h12v10H6z" />
      {/* Text lines */}
      <line x1="9" y1="10" x2="15" y2="10" />
      <line x1="9" y1="13" x2="13" y2="13" />
    </svg>
  )
}

/**
 * Scenarios icon (clipboard with a checkmark — for the general scenarios page)
 */
function ScenariosNavIcon({ className }: { className?: string }) {
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
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  )
}

/**
 * Chat/message icon
 */
function ChatIcon({ className }: { className?: string }) {
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
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

interface NavItem {
  id: string
  label: string
  tooltip: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

const navItems: NavItem[] = [
  { id: 'projects', label: 'Projects', tooltip: 'View all projects', href: '/prospero', icon: ProsperoIcon },
  { id: 'files', label: 'Files', tooltip: 'View all files', href: '/files', icon: FileIcon },
  { id: 'scriptorium', label: 'The Scriptorium', tooltip: 'View document stores', href: '/scriptorium', icon: ScriptoriumIcon },
  { id: 'characters', label: 'Characters', tooltip: 'View all characters', href: '/aurora', icon: CharacterIcon },
  { id: 'scenarios', label: 'Scenarios', tooltip: 'Manage general scenarios', href: '/scenarios', icon: ScenariosNavIcon },
  { id: 'chats', label: 'Chats', tooltip: 'View all chats', href: '/salon', icon: ChatIcon },
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
        <Image
          src="/quill.svg"
          alt="Home"
          width={28}
          height={28}
          className="w-7 h-7"
        />
      </a>
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <a
            key={item.id}
            href={item.href}
            className="qt-collapsed-nav-button"
            title={item.tooltip}
            aria-label={item.tooltip}
          >
            <Icon className="w-5 h-5" />
          </a>
        )
      })}
    </nav>
  )
}
