'use client'

/**
 * RecentChatItem
 *
 * One conversation in the home page's recent list: its picture, its title in
 * full (two lines if it needs them), and a line saying who, where and when.
 */

import Link from 'next/link'
import AvatarStack from '@/components/ui/AvatarStack'
import { formatMessageTime } from '@/lib/format-time'
import type { RecentChat } from './types'
import { chatActivityAt } from '@/lib/chat/chat-activity'
import { ConciergeMark } from '@/components/chat/ConciergeMark'
import { activeCast, castNames } from './chat-cast'

interface RecentChatItemProps {
  chat: RecentChat
}

export function RecentChatItem({ chat }: RecentChatItemProps) {
  const href = `/salon/${chat.id}`
  const cast = activeCast(chat)

  return (
    <Link
      href={href}
      className="qt-homepage-row"
    >
      {/* Story background thumbnail (preferred) or Avatar stack */}
      {chat.storyBackgroundUrl ? (
        <div className="qt-homepage-row-picture">
          <img src={chat.storyBackgroundUrl} alt="" />
        </div>
      ) : (
        <div className="qt-homepage-row-picture" data-kind="avatars">
          <AvatarStack entities={cast} size="sm" maxDisplay={2} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="qt-card-title qt-homepage-row-title">
          {chat.title}
        </p>
        <p className="qt-card-subtitle truncate">
          {castNames(cast)}
          {chat.project && <> &middot; {chat.project.name}</>}
        </p>
      </div>
      <div className="flex flex-col items-end shrink-0">
        <span className="qt-meta">
          {formatMessageTime(chatActivityAt(chat))}
        </span>
        <span className="qt-meta qt-text-brand">
          {chat._count.messages} msgs
          {chat.conciergeState && (
            <ConciergeMark
              conciergeState={chat.conciergeState}
              conciergeSetBy={chat.conciergeSetBy}
              conciergeReason={chat.conciergeReason}
              dangerCategories={chat.dangerCategories}
            />
          )}
        </span>
      </div>
    </Link>
  )
}
