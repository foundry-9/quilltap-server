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
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mt-8">
      {/* Characters Card */}
      <Link href="/characters">
        <div className="dashboard-card h-full flex flex-col rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm dark:shadow-lg hover:border-blue-500 hover:shadow-md dark:hover:border-blue-500 dark:hover:shadow-md transition-all cursor-pointer">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Characters</h2>
            <span className="dashboard-badge rounded-full bg-blue-100 dark:bg-blue-900 px-3 py-1 text-sm font-medium text-blue-800 dark:text-blue-200">
              {visibleCounts.characters}
            </span>
          </div>
          <p className="flex-1 text-sm text-gray-600 dark:text-gray-400">
            Create and manage your AI characters
          </p>
        </div>
      </Link>

      {/* Chats Card */}
      <Link href="/chats">
        <div className="dashboard-card h-full flex flex-col rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm dark:shadow-lg hover:border-green-500 hover:shadow-md dark:hover:border-green-500 dark:hover:shadow-md transition-all cursor-pointer">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Chats</h2>
            <span className="dashboard-badge rounded-full bg-green-100 dark:bg-green-900 px-3 py-1 text-sm font-medium text-green-800 dark:text-green-200">
              {visibleCounts.chats}
            </span>
          </div>
          <p className="flex-1 text-sm text-gray-600 dark:text-gray-400">
            Start conversations with your characters
          </p>
        </div>
      </Link>

      {/* Personas Card */}
      <Link href="/personas">
        <div className="dashboard-card h-full flex flex-col rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm dark:shadow-lg hover:border-purple-500 hover:shadow-md dark:hover:border-purple-500 dark:hover:shadow-md transition-all cursor-pointer">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Personas</h2>
            <span className="dashboard-badge rounded-full bg-purple-100 dark:bg-purple-900 px-3 py-1 text-sm font-medium text-purple-800 dark:text-purple-200">
              {visibleCounts.personas}
            </span>
          </div>
          <p className="flex-1 text-sm text-gray-600 dark:text-gray-400">
            Manage your user personas
          </p>
        </div>
      </Link>
    </div>
  )
}
