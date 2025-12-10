'use client'

import { useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { clientLogger } from '@/lib/client-logger'

interface DashboardCardsProps {
  characters: Array<{ id: string; tags: string[] }>
  chats: Array<{ id: string; tags: string[] }>
  personas: Array<{ id: string; tags: string[] }>
}

export function DashboardCards({ characters, chats, personas }: DashboardCardsProps) {
  const { shouldHideByIds, hiddenTagIds } = useQuickHide()

  const visibleCounts = useMemo(() => {
    const visibleCharacters = characters.filter(c => !shouldHideByIds(c.tags))
    const visibleChats = chats.filter(c => !shouldHideByIds(c.tags))
    const visiblePersonas = personas.filter(p => !shouldHideByIds(p.tags))

    return {
      characters: visibleCharacters.length,
      chats: visibleChats.length,
      personas: visiblePersonas.length,
      totalCharacters: characters.length,
      totalChats: chats.length,
      totalPersonas: personas.length,
    }
  }, [characters, chats, personas, shouldHideByIds])

  useEffect(() => {
    clientLogger.debug('Dashboard cards filtered counts', {
      hiddenTagCount: hiddenTagIds.size,
      counts: visibleCounts,
    })
  }, [visibleCounts, hiddenTagIds.size])

  return (
    <div className="qt-card-grid mt-8">
      {/* Characters Card */}
      <Link href="/characters">
        <div className="qt-card-interactive dashboard-card h-full flex flex-col">
          <div className="qt-card-header">
            <h2 className="qt-card-title">Characters</h2>
            <span className="qt-badge-characters dashboard-badge">
              {visibleCounts.characters}
            </span>
          </div>
          <p className="qt-card-description flex-1">
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
          <p className="qt-card-description flex-1">
            Start conversations with your characters
          </p>
        </div>
      </Link>

      {/* Personas Card */}
      <Link href="/personas">
        <div className="qt-card-interactive dashboard-card h-full flex flex-col">
          <div className="qt-card-header">
            <h2 className="qt-card-title">Personas</h2>
            <span className="qt-badge-personas dashboard-badge">
              {visibleCounts.personas}
            </span>
          </div>
          <p className="qt-card-description flex-1">
            Manage your user personas
          </p>
        </div>
      </Link>
    </div>
  )
}
