/**
 * RecentChatsSection
 *
 * The conversations before the latest one, in rows wide enough for a whole
 * title. Quick-hide has already been applied by `ChatsBand`.
 */

import Link from 'next/link'
import { RecentChatItem } from './RecentChatItem'
import type { RecentChatsSectionProps } from './types'

/** Rows shown: about the height of the resume card beside them. */
export const RECENT_CHAT_ROWS = 6

export function RecentChatsSection({ chats }: RecentChatsSectionProps) {
  return (
    <section className="qt-homepage-section" data-section="chats">
      <div className="qt-homepage-section-header">
        <h2 className="qt-homepage-section-title">Recent Conversations</h2>
        <Link href="/salon" className="qt-homepage-section-link">
          View all &rarr;
        </Link>
      </div>
      <div className="qt-homepage-section-content">
        {chats.slice(0, RECENT_CHAT_ROWS).map(chat => (
          <RecentChatItem key={chat.id} chat={chat} />
        ))}
      </div>
    </section>
  )
}
