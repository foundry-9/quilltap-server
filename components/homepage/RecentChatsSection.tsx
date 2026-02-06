/**
 * RecentChatsSection
 *
 * Client component displaying recent chats on the homepage with quick-hide filtering.
 */

'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { RecentChatItem } from './RecentChatItem'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import type { RecentChatsSectionProps } from './types'

export function RecentChatsSection({ chats }: RecentChatsSectionProps) {
  const { shouldHideByIds, hideDangerousChats } = useQuickHide()

  // Filter chats using quick-hide (same logic as chats page)
  // CSS overflow:hidden will hide chats that don't fit in the card
  const visibleChats = useMemo(() => {
    return chats.filter(chat => {
      // Hide dangerous chats when filter is active
      if (hideDangerousChats && chat.isDangerousChat) {
        return false
      }

      // Collect all tag IDs from character participants
      const allTagIds: string[] = []

      for (const participant of chat.participants) {
        if (participant.character?.tags) {
          allTagIds.push(...participant.character.tags)
        }
      }

      return !shouldHideByIds(allTagIds)
    })
  }, [chats, shouldHideByIds, hideDangerousChats])

  return (
    <div className="qt-homepage-section">
      <div className="qt-homepage-section-header">
        <h2 className="qt-homepage-section-title">Recent Chats</h2>
        <Link href="/chats" className="qt-homepage-section-link">
          View all &rarr;
        </Link>
      </div>
      <div className="qt-homepage-section-content">
        {visibleChats.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <p className="text-sm">No chats yet</p>
            <Link href="/chats/new" className="text-xs text-primary hover:underline">
              Start your first chat
            </Link>
          </div>
        ) : (
          visibleChats.map(chat => (
            <RecentChatItem key={chat.id} chat={chat} />
          ))
        )}
      </div>
    </div>
  )
}
