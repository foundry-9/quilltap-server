'use client'

/**
 * Chats Section
 *
 * Displays recent chats in the sidebar.
 * Uses SidebarDataProvider for centralized data fetching and refresh.
 *
 * @module components/layout/left-sidebar/chats-section
 */

import Link from 'next/link'
import { useSidebar } from '@/components/providers/sidebar-provider'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { useSidebarData, type SidebarChat } from '@/components/providers/sidebar-data-provider'
import { SidebarSection } from './sidebar-section'
import { ViewAllLink } from './sidebar-item'

/**
 * Message icon (for default chat icon)
 */
function MessageIcon({ className }: { className?: string }) {
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

function getChatDisplayName(chat: SidebarChat): string {
  if (chat.title) return chat.title
  // Filter out undefined participants and those without names
  const validParticipants = chat.participants.filter(p => p && p.name)
  if (validParticipants.length > 0) {
    const names = validParticipants.map(p => p.name)
    if (names.length <= 2) return names.join(' & ')
    return `${names[0]} +${names.length - 1}`
  }
  return 'Untitled Chat'
}

/**
 * Folder icon for project indicator
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
      <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  )
}

function ChatItem({
  chat,
  isCollapsed,
}: {
  chat: SidebarChat
  isCollapsed: boolean
}) {
  const displayName = getChatDisplayName(chat)
  const firstParticipant = chat.participants[0]
  const avatarSrc = firstParticipant?.avatarUrl
  const messageCount = chat.messageCount || 0
  const hasProject = !!chat.projectId

  return (
    <Link
      href={`/chats/${chat.id}`}
      className={`qt-left-sidebar-item ${isCollapsed ? 'justify-center px-0' : ''}`}
      title={isCollapsed ? `${displayName}${chat.projectName ? ` (${chat.projectName})` : ''} (${messageCount} messages)` : undefined}
    >
      {avatarSrc ? (
        <img
          src={avatarSrc}
          alt={displayName}
          className="w-6 h-6 rounded-full object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
          <MessageIcon className="w-3 h-3 text-muted-foreground" />
        </div>
      )}
      {!isCollapsed && (
        <>
          <div className="flex-1 min-w-0">
            <span className="qt-left-sidebar-item-label block truncate">{displayName}</span>
            {hasProject && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground truncate">
                <FolderIcon className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{chat.projectName}</span>
              </span>
            )}
          </div>
          {messageCount > 0 && (
            <span className="ml-auto px-1.5 py-0.5 text-xs bg-muted text-muted-foreground rounded-full flex-shrink-0">
              {messageCount > 999 ? '999+' : messageCount}
            </span>
          )}
        </>
      )}
    </Link>
  )
}

export function ChatsSection() {
  const { isCollapsed } = useSidebar()
  const { shouldHideByIds } = useQuickHide()
  const { chats, loading } = useSidebarData()

  // Don't show section if loading or no chats
  if (loading) {
    return (
      <SidebarSection id="chats" title="Chats" grow collapsible={false}>
        <div className="px-2 py-1 text-xs text-muted-foreground animate-pulse">
          {!isCollapsed && 'Loading...'}
        </div>
      </SidebarSection>
    )
  }

  // Filter out chats with hidden character tags AND chats that belong to projects
  // Project chats are shown under their respective projects in the projects section
  const visibleChats = chats.filter(
    chat => !shouldHideByIds(chat.characterTags) && !chat.projectId
  )

  if (visibleChats.length === 0) {
    return (
      <SidebarSection id="chats" title="Chats" grow collapsible={false}>
        <div className="px-2 py-1 text-xs text-muted-foreground">
          {!isCollapsed && 'No chats yet'}
        </div>
        <ViewAllLink href="/chats" label="Start one" />
      </SidebarSection>
    )
  }

  return (
    <SidebarSection id="chats" title="Chats" grow collapsible={false}>
      {visibleChats.slice(0, 10).map(chat => (
        <ChatItem
          key={chat.id}
          chat={chat}
          isCollapsed={isCollapsed}
        />
      ))}
      <ViewAllLink href="/chats" />
    </SidebarSection>
  )
}
