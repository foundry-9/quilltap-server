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
  if (chat.participants.length > 0) {
    const names = chat.participants.map(p => p.name)
    if (names.length <= 2) return names.join(' & ')
    return `${names[0]} +${names.length - 1}`
  }
  return 'Untitled Chat'
}

function ChatItem({
  chat,
  isCollapsed,
  onClick,
}: {
  chat: SidebarChat
  isCollapsed: boolean
  onClick: () => void
}) {
  const displayName = getChatDisplayName(chat)
  const firstParticipant = chat.participants[0]
  const avatarSrc = firstParticipant?.avatarUrl
  const messageCount = chat.messageCount || 0

  return (
    <Link
      href={`/chats/${chat.id}`}
      className={`qt-left-sidebar-item ${isCollapsed ? 'justify-center px-0' : ''}`}
      onClick={onClick}
      title={isCollapsed ? `${displayName} (${messageCount} messages)` : undefined}
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
          <span className="qt-left-sidebar-item-label">{displayName}</span>
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
  const { isCollapsed, closeMobile, isMobile } = useSidebar()
  const { shouldHideByIds } = useQuickHide()
  const { chats, loading } = useSidebarData()

  const handleItemClick = () => {
    if (isMobile) {
      closeMobile()
    }
  }

  // Don't show section if loading or no chats
  if (loading) {
    return (
      <SidebarSection title="Chats" grow>
        <div className="px-2 py-1 text-xs text-muted-foreground animate-pulse">
          {!isCollapsed && 'Loading...'}
        </div>
      </SidebarSection>
    )
  }

  // Filter out chats with hidden character tags
  const visibleChats = chats.filter(
    chat => !shouldHideByIds(chat.characterTags)
  )

  if (visibleChats.length === 0) {
    return (
      <SidebarSection title="Chats" grow>
        <div className="px-2 py-1 text-xs text-muted-foreground">
          {!isCollapsed && 'No chats yet'}
        </div>
        <ViewAllLink href="/chats" label="Start one" />
      </SidebarSection>
    )
  }

  return (
    <SidebarSection title="Chats" grow>
      {visibleChats.slice(0, 10).map(chat => (
        <ChatItem
          key={chat.id}
          chat={chat}
          isCollapsed={isCollapsed}
          onClick={handleItemClick}
        />
      ))}
      <ViewAllLink href="/chats" />
    </SidebarSection>
  )
}
