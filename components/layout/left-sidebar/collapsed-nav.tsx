'use client'

/**
 * Collapsed Navigation
 *
 * Navigation links shown in the always-collapsed sidebar.
 * Each item is a direct Link to the corresponding view-all page.
 *
 * @module components/layout/left-sidebar/collapsed-nav
 */

import { useRouter } from 'next/navigation'
import Image from 'next/image'

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
 * Character icon (person silhouette)
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
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
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
  { id: 'projects', label: 'Projects', tooltip: 'View all projects', href: '/prospero', icon: FolderIcon },
  { id: 'files', label: 'Files', tooltip: 'View all files', href: '/files', icon: FileIcon },
  { id: 'characters', label: 'Characters', tooltip: 'View all characters', href: '/aurora', icon: CharacterIcon },
  { id: 'chats', label: 'Chats', tooltip: 'View all chats', href: '/salon', icon: ChatIcon },
]

export function CollapsedNav() {
  const router = useRouter()

  return (
    <nav className="qt-collapsed-nav" aria-label="Quick navigation">
      {/* Home button — uses <a> + router.push() instead of <Link> to avoid startTransition stall on chat page */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="qt-collapsed-nav-button"
        title="Home"
        aria-label="Home"
        onClick={(e) => { e.preventDefault(); router.push('/') }}
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
            onClick={(e) => { e.preventDefault(); router.push(item.href) }}
          >
            <Icon className="w-5 h-5" />
          </a>
        )
      })}
    </nav>
  )
}
