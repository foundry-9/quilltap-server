'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { TagDisplay } from '@/components/tags/tag-display'
import { usePersonaDisplayName } from '@/hooks/usePersonaDisplayName'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { clientLogger } from '@/lib/client-logger'
import Avatar from '@/components/ui/Avatar'
import AvatarStack from '@/components/ui/AvatarStack'

interface CharacterInfo {
  id: string
  name: string
  avatarUrl?: string | null
  defaultImageId?: string | null
  defaultImage?: {
    id: string
    filepath: string
    url?: string | null
  } | null
  tags?: string[]
}

interface RecentChat {
  id: string
  title: string
  updatedAt: string | Date
  messageCount: number
  characters: CharacterInfo[]
  persona?: {
    id: string
    name: string
    title?: string | null
    tags?: string[]
  } | null
  tags: Array<{
    tag: {
      id: string
      name: string
    }
  }>
}

interface RecentChatsSectionProps {
  chats: RecentChat[]
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'UTC',
})

function formatCharacterNames(characters: CharacterInfo[]): string {
  if (characters.length === 0) return 'Unknown'
  if (characters.length === 1) return characters[0].name
  if (characters.length === 2) return `${characters[0].name} + ${characters[1].name}`
  return characters.map(c => c.name).join(' + ')
}

// Transform API response to RecentChat format
function transformApiChatToRecentChat(apiChat: any): RecentChat {
  const characters: CharacterInfo[] = []
  let persona: RecentChat['persona'] = null

  for (const participant of apiChat.participants || []) {
    if (participant.type === 'CHARACTER' && participant.character) {
      characters.push({
        id: participant.character.id,
        name: participant.character.name,
        avatarUrl: participant.character.avatarUrl,
        defaultImageId: participant.character.defaultImageId,
        defaultImage: participant.character.defaultImage,
        tags: participant.character.tags || [],
      })
    }
    if (participant.type === 'PERSONA' && participant.persona) {
      persona = {
        id: participant.persona.id,
        name: participant.persona.name,
        title: participant.persona.title,
        tags: participant.persona.tags || [],
      }
    }
  }

  return {
    id: apiChat.id,
    title: apiChat.title,
    updatedAt: apiChat.updatedAt,
    messageCount: apiChat._count?.messages || 0,
    characters,
    persona,
    tags: apiChat.tags || [],
  }
}

export function RecentChatsSection({ chats: initialChats }: RecentChatsSectionProps) {
  const { formatPersonaName } = usePersonaDisplayName()
  const { hiddenTagIds, loading: quickHideLoading } = useQuickHide()
  const [chats, setChats] = useState<RecentChat[]>(initialChats)
  const [loading, setLoading] = useState(false)
  const [hasInitialized, setHasInitialized] = useState(false)

  // Fetch recent chats from API with excluded tags
  const fetchRecentChats = useCallback(async (excludeTagIds: string[]) => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.set('limit', '5')
      if (excludeTagIds.length > 0) {
        params.set('excludeTagIds', excludeTagIds.join(','))
      }

      clientLogger.debug('Fetching recent chats', {
        excludeTagIds: excludeTagIds.length > 0 ? excludeTagIds : undefined,
      })

      const response = await fetch(`/api/chats?${params.toString()}`, {
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error('Failed to fetch chats')
      }

      const data = await response.json()
      const transformedChats = (data.chats || []).map(transformApiChatToRecentChat)

      clientLogger.debug('Received recent chats', {
        count: transformedChats.length,
        excludedTagCount: excludeTagIds.length,
      })

      setChats(transformedChats)
    } catch (error) {
      clientLogger.error('Error fetching recent chats', {
        error: error instanceof Error ? error.message : String(error),
      })
      // On error, keep the existing chats
    } finally {
      setLoading(false)
    }
  }, [])

  // Refetch when hiddenTagIds changes (after initial load)
  useEffect(() => {
    // Wait for quick-hide provider to finish loading
    if (quickHideLoading) {
      return
    }

    // Mark as initialized after first render with quick-hide ready
    if (!hasInitialized) {
      setHasInitialized(true)
      // If there are hidden tags on initial load, fetch filtered data
      if (hiddenTagIds.size > 0) {
        fetchRecentChats(Array.from(hiddenTagIds))
      }
      return
    }

    // After initialization, always refetch when hiddenTagIds changes
    clientLogger.debug('Quick-hide state changed, refetching recent chats', {
      hiddenTagCount: hiddenTagIds.size,
    })
    fetchRecentChats(Array.from(hiddenTagIds))
  }, [hiddenTagIds, quickHideLoading, hasInitialized, fetchRecentChats])

  // Use the chats directly - filtering is done server-side now
  const visibleChats = chats

  return (
    <div className="mt-8 sm:flex-1 sm:flex sm:flex-col sm:min-h-0">
      <div className="flex items-center gap-2 mb-4 justify-end sm:justify-start">
        <h3 className="text-xl font-semibold text-foreground">
          Recent Chats
        </h3>
        {loading && (
          <span className="qt-text-small animate-pulse">
            updating...
          </span>
        )}
      </div>
      {visibleChats.length > 0 ? (
        <div className="space-y-3 pb-4 sm:flex-1 sm:overflow-y-auto">
          {visibleChats.map((chat) => {
            const characters = chat.characters
            const characterNames = formatCharacterNames(characters)

            // Get first character for mobile
            const firstChar = characters[0]

            return (
              <div key={chat.id}>
                {/* Mobile: compact horizontal card */}
                <Link
                  href={`/chats/${chat.id}`}
                  className="flex sm:hidden items-center gap-2 p-2 rounded-lg border border-border bg-card hover:border-primary hover:shadow-md transition-all"
                >
                  <Avatar
                    name={firstChar?.name || 'Chat'}
                    src={firstChar}
                    size="sm"
                  />
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h4 className="text-xs font-semibold text-foreground truncate">
                        {chat.title}
                      </h4>
                      <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 qt-badge-primary">
                        {chat.messageCount}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {characterNames}
                      {chat.persona && ` with ${formatPersonaName(chat.persona)}`}
                    </p>
                  </div>
                </Link>

                {/* Desktop: full card */}
                <Link
                  href={`/chats/${chat.id}`}
                  className="hidden sm:block qt-card-interactive"
                >
                  <div className="flex items-stretch justify-between gap-3">
                    <div className="flex items-stretch gap-4 flex-grow">
                      <AvatarStack entities={characters} size="lg" />
                      <div className="flex-grow min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-foreground truncate">
                            {chat.title}
                          </h4>
                          <span className="inline-block text-sm font-semibold px-3 py-1 rounded-full flex-shrink-0 qt-badge-primary">
                            {chat.messageCount}
                          </span>
                        </div>
                        <p className="qt-text-small mt-1 truncate">
                          {characterNames}
                          {chat.persona && ` with ${formatPersonaName(chat.persona)}`}
                        </p>
                        {chat.tags.length > 0 && (
                          <div className="mt-2">
                            <TagDisplay tags={chat.tags.map(ct => ct.tag)} />
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="qt-text-xs whitespace-nowrap flex-shrink-0">
                      {dateFormatter.format(new Date(chat.updatedAt))}
                    </span>
                  </div>
                </Link>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="qt-card p-8 text-center">
          <p className="text-muted-foreground">
            No chats yet. Create a character and start your first conversation!
          </p>
        </div>
      )}
    </div>
  )
}
