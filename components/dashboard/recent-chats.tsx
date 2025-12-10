'use client'

import { useMemo, useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { TagDisplay } from '@/components/tags/tag-display'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { clientLogger } from '@/lib/client-logger'

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

function getCharacterAvatarSrc(character: CharacterInfo): string | null {
  if (character.defaultImage) {
    const filepath = character.defaultImage.filepath
    return character.defaultImage.url || (filepath.startsWith('/') ? filepath : `/${filepath}`)
  }
  return character.avatarUrl || null
}

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
  const { style } = useAvatarDisplay()
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
    <div className="mt-8 flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-xl font-semibold text-foreground">
          Recent Chats
        </h3>
        {loading && (
          <span className="text-sm text-muted-foreground animate-pulse">
            updating...
          </span>
        )}
      </div>
      {visibleChats.length > 0 ? (
        <div className="space-y-3 flex-1 overflow-y-auto pb-4">
          {visibleChats.map((chat) => {
            const characters = chat.characters
            const characterNames = formatCharacterNames(characters)

            // Render avatar(s)
            const renderAvatars = () => {
              if (characters.length === 0) {
                return (
                  <div
                    className={`${style === 'CIRCULAR' ? 'w-20 rounded-full' : 'w-16'} h-full bg-gray-300 dark:bg-slate-700 flex items-center justify-center flex-shrink-0`}
                    style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}
                  >
                    <span className={getAvatarClasses(style, 'lg').fallbackClass}>?</span>
                  </div>
                )
              }

              if (characters.length === 1) {
                const avatarSrc = getCharacterAvatarSrc(characters[0])
                if (avatarSrc) {
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarSrc}
                      alt={characters[0].name}
                      className={`${style === 'CIRCULAR' ? 'w-20 rounded-full' : 'w-16'} h-full object-cover flex-shrink-0`}
                      style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}
                    />
                  )
                }
                return (
                  <div
                    className={`${style === 'CIRCULAR' ? 'w-20 rounded-full' : 'w-16'} h-full bg-gray-300 dark:bg-slate-700 flex items-center justify-center flex-shrink-0`}
                    style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}
                  >
                    <span className={getAvatarClasses(style, 'lg').fallbackClass}>
                      {characters[0].name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )
              }

              // Multi-character: show stacked/overlapping avatars (max 4)
              const displayChars = characters.slice(0, 4)
              const overlapOffset = style === 'CIRCULAR' ? -12 : -10

              return (
                <div className="flex items-stretch h-full" style={{ marginRight: `${Math.abs(overlapOffset) * (displayChars.length - 1)}px` }}>
                  {displayChars.map((char, index) => {
                    const avatarSrc = getCharacterAvatarSrc(char)
                    const zIndex = displayChars.length - index
                    const marginLeft = index === 0 ? 0 : overlapOffset

                    if (avatarSrc) {
                      return (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={char.id}
                          src={avatarSrc}
                          alt={char.name}
                          className={`${style === 'CIRCULAR' ? 'w-14 rounded-full' : 'w-11'} h-full object-cover ring-2 ring-card flex-shrink-0`}
                          style={{ zIndex, marginLeft: `${marginLeft}px`, position: 'relative', ...(style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : {}) }}
                          title={char.name}
                        />
                      )
                    }
                    return (
                      <div
                        key={char.id}
                        className={`${style === 'CIRCULAR' ? 'w-14 rounded-full' : 'w-11'} h-full bg-gray-300 dark:bg-slate-700 flex items-center justify-center ring-2 ring-card flex-shrink-0`}
                        style={{
                          zIndex,
                          marginLeft: `${marginLeft}px`,
                          position: 'relative',
                          ...(style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : {})
                        }}
                        title={char.name}
                      >
                        <span className={getAvatarClasses(style, 'md').fallbackClass}>
                          {char.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )
                  })}
                  {characters.length > 4 && (
                    <div
                      className={`${style === 'CIRCULAR' ? 'w-14 rounded-full' : 'w-11'} h-full bg-muted flex items-center justify-center ring-2 ring-card flex-shrink-0`}
                      style={{ zIndex: 0, marginLeft: `${overlapOffset}px`, position: 'relative' }}
                      title={`+${characters.length - 4} more`}
                    >
                      <span className="text-sm font-bold text-muted-foreground">
                        +{characters.length - 4}
                      </span>
                    </div>
                  )}
                </div>
              )
            }

            return (
              <Link
                key={chat.id}
                href={`/chats/${chat.id}`}
                className="block qt-card-interactive"
              >
                <div className="flex items-stretch justify-between gap-3">
                  <div className="flex items-stretch gap-4 flex-grow">
                    {renderAvatars()}
                    <div className="flex-grow min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold text-foreground truncate">
                          {chat.title}
                        </h4>
                        <span className="inline-block text-sm font-semibold px-3 py-1 rounded-full flex-shrink-0 qt-badge-primary">
                          {chat.messageCount}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 truncate">
                        with {characterNames}
                        {chat.persona && ` as ${chat.persona.name}${chat.persona.title ? ` - ${chat.persona.title}` : ''}`}
                      </p>
                      {chat.tags.length > 0 && (
                        <div className="mt-2">
                          <TagDisplay tags={chat.tags.map(ct => ct.tag)} />
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                    {dateFormatter.format(new Date(chat.updatedAt))}
                  </span>
                </div>
              </Link>
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
