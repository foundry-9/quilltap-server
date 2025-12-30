'use client'

import { useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { clientLogger } from '@/lib/client-logger'

interface DashboardCardsProps {
  characters: Array<{ id: string; tags: string[] }>
  chats: Array<{ id: string; tags: string[] }>
}

export function DashboardCards({ characters, chats }: DashboardCardsProps) {
  const { shouldHideByIds, hiddenTagIds } = useQuickHide()

  const visibleCounts = useMemo(() => {
    const visibleCharacters = characters.filter(c => !shouldHideByIds(c.tags))
    const visibleChats = chats.filter(c => !shouldHideByIds(c.tags))

    return {
      characters: visibleCharacters.length,
      chats: visibleChats.length,
      totalCharacters: characters.length,
      totalChats: chats.length,
    }
  }, [characters, chats, shouldHideByIds])

  useEffect(() => {
    clientLogger.debug('Dashboard cards filtered counts', {
      hiddenTagCount: hiddenTagIds.size,
      counts: visibleCounts,
    })
  }, [visibleCounts, hiddenTagIds.size])

  return (
    <div className="qt-card-grid-2 mt-8">
      {/* Characters Card */}
      <Link href="/characters">
        <div className="qt-card-interactive dashboard-card h-full flex flex-col">
          <div className="qt-card-header">
            <h2 className="qt-card-title">Characters</h2>
            <span className="qt-badge-characters dashboard-badge">
              {visibleCounts.characters}
            </span>
          </div>
          <p className="qt-card-description flex-1 hidden sm:block">
            Create and manage your AI characters
          </p>
        </div>
      </Link>

      {/* Chats Card */}
      <Link href="/chats">
        <div className="qt-card-interactive dashboard-card h-full flex flex-col">
          <div className="qt-card-header">
            <h2 className="qt-card-title">Chats</h2>
            <span className="qt-badge-chats dashboard-badge">
              {visibleCounts.chats}
            </span>
          </div>
          <p className="qt-card-description flex-1 hidden sm:block">
            Start conversations with your characters
          </p>
        </div>
      </Link>

    </div>
  )
}
