/**
 * RecentChatsSection
 *
 * Server component displaying recent chats on the homepage.
 */

import Link from 'next/link'
import { RecentChatItem } from './RecentChatItem'
import type { RecentChatsSectionProps } from './types'

export function RecentChatsSection({ chats }: RecentChatsSectionProps) {
  return (
    <div className="qt-homepage-section">
      <div className="qt-homepage-section-header">
        <h2 className="qt-homepage-section-title">Recent Chats</h2>
        <Link href="/chats" className="qt-homepage-section-link">
          View all &rarr;
        </Link>
      </div>
      <div className="qt-homepage-section-content">
        {chats.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <p className="text-sm">No chats yet</p>
            <Link href="/chats/new" className="text-xs text-primary hover:underline">
              Start your first chat
            </Link>
          </div>
        ) : (
          chats.map(chat => (
            <RecentChatItem key={chat.id} chat={chat} />
          ))
        )}
      </div>
    </div>
  )
}
