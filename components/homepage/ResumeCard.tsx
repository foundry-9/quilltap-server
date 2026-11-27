'use client'

/**
 * ResumeCard
 *
 * The conversation last touched, given room: its story background at size, its
 * title in full, who is in it, a line on where things stand, and one button to
 * step back in.
 */

import Link from 'next/link'
import AvatarStack from '@/components/ui/AvatarStack'
import { Icon } from '@/components/ui/icon'
import { ConciergeMark } from '@/components/chat/ConciergeMark'
import { formatMessageTime } from '@/lib/format-time'
import { chatActivityAt } from '@/lib/chat/chat-activity'
import { activeCast, castNames, messageCountLabel } from './chat-cast'
import type { RecentChat } from './types'

interface ResumeCardProps {
  chat: RecentChat
}

export function ResumeCard({ chat }: ResumeCardProps) {
  const href = `/salon/${chat.id}`
  const cast = activeCast(chat)

  return (
    <section className="qt-homepage-section" data-section="resume">
      <Link
        href={href}
        className="qt-homepage-resume-picture"
        tabIndex={-1}
        aria-hidden="true"
      >
        {chat.storyBackgroundUrl ? (
          <img src={chat.storyBackgroundUrl} alt="" />
        ) : (
          <AvatarStack entities={cast} size="lg" maxDisplay={4} />
        )}
      </Link>
      <div className="qt-homepage-resume-body">
        <div className="qt-homepage-section-header">
          <h2 className="qt-homepage-section-title">Where You Left Off</h2>
          <span className="qt-meta">{formatMessageTime(chatActivityAt(chat))}</span>
        </div>
        <div className="qt-homepage-section-content">
          <h3 className="qt-homepage-resume-title">
            <Link href={href}>
              {chat.title}
            </Link>
          </h3>
          <p className="qt-card-subtitle">
            {castNames(cast)}
            {chat.project && <> &middot; {chat.project.name}</>}
          </p>
          {chat.summaryExcerpt && (
            <p className="qt-homepage-resume-excerpt">{chat.summaryExcerpt}</p>
          )}
          <div className="qt-homepage-resume-actions">
            <Link
              href={href}
              className="qt-button qt-button-primary gap-2"
              aria-label={`Resume ${chat.title}`}
            >
              <Icon name="play" className="w-4 h-4" />
              Resume
            </Link>
            <span className="qt-meta">
              {messageCountLabel(chat._count.messages)}
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
        </div>
      </div>
    </section>
  )
}
