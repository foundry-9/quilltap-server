'use client'

/**
 * ChatsBand
 *
 * The home page's first band: the conversation last touched, as a resume card,
 * beside the ones before it. Quick-hide is applied here, once, so the resume
 * card is always the newest chat the operator is willing to have on screen.
 */

import { useMemo } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { ResumeCard } from './ResumeCard'
import { RecentChatsSection } from './RecentChatsSection'
import { chatCharacterTags } from './chat-cast'
import type { ChatsBandProps } from './types'

export function ChatsBand({ chats }: ChatsBandProps) {
  const { shouldHideChat } = useQuickHide()

  // One rule, shared with every other chat list.
  const visibleChats = useMemo(
    () => chats.filter(chat => !shouldHideChat({
      characterTags: chatCharacterTags(chat),
      conciergeState: chat.conciergeState,
    })),
    [chats, shouldHideChat]
  )

  if (visibleChats.length === 0) {
    return (
      <section className="qt-homepage-section" data-section="resume">
        <div className="qt-homepage-section-content">
          <div className="qt-homepage-empty">
            <p className="qt-card-title">The salon stands ready</p>
            <p className="qt-card-subtitle">
              No conversation is under way. Choose a companion, or begin one from a blank page.
            </p>
            <Link href="/salon/new" className="qt-button qt-button-primary gap-2">
              <Icon name="chat" className="w-4 h-4" />
              Start your first chat
            </Link>
          </div>
        </div>
      </section>
    )
  }

  const [latest, ...earlier] = visibleChats

  return (
    <div className="qt-homepage-chats" data-solo={earlier.length === 0 ? 'true' : undefined}>
      <ResumeCard chat={latest} />
      {earlier.length > 0 && <RecentChatsSection chats={earlier} />}
    </div>
  )
}
