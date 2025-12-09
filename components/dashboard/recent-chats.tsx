'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { TagDisplay } from '@/components/tags/tag-display'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { useQuickHide } from '@/components/providers/quick-hide-provider'

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

export function RecentChatsSection({ chats }: RecentChatsSectionProps) {
  const { style } = useAvatarDisplay()
  const { shouldHideByIds } = useQuickHide()
  const visibleChats = useMemo(
    () => chats.filter(chat => !shouldHideByIds(chat.tags.map(ct => ct.tag.id))),
    [chats, shouldHideByIds]
  )

  return (
    <div className="mt-8">
      <h3 className="mb-4 text-xl font-semibold text-foreground">
        Recent Chats
      </h3>
      {visibleChats.length > 0 ? (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {visibleChats.map((chat) => {
            const characters = chat.characters
            const characterNames = formatCharacterNames(characters)

            // Render avatar(s)
            const renderAvatars = () => {
              if (characters.length === 0) {
                return (
                  <div className={getAvatarClasses(style, 'lg').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
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
                      width={64}
                      height={64}
                      className={getAvatarClasses(style, 'lg').imageClass}
                    />
                  )
                }
                return (
                  <div className={getAvatarClasses(style, 'lg').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
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
                <div className="flex items-center" style={{ marginRight: `${Math.abs(overlapOffset) * (displayChars.length - 1)}px` }}>
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
                          width={48}
                          height={48}
                          className={`${getAvatarClasses(style, 'md').imageClass} ring-2 ring-card`}
                          style={{ zIndex, marginLeft: `${marginLeft}px`, position: 'relative' }}
                          title={char.name}
                        />
                      )
                    }
                    return (
                      <div
                        key={char.id}
                        className={`${getAvatarClasses(style, 'md').wrapperClass} ring-2 ring-card`}
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
                      className={`${getAvatarClasses(style, 'md').wrapperClass} ring-2 ring-card bg-muted`}
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
                className="block rounded-lg border border-border bg-card p-4 shadow-sm hover:border-primary transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-4 flex-grow">
                    {renderAvatars()}
                    <div className="flex-grow min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold text-foreground truncate">
                          {chat.title}
                        </h4>
                        <span className="inline-block bg-primary/10 text-primary text-sm font-semibold px-3 py-1 rounded-full flex-shrink-0">
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
        <div className="rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <p className="text-muted-foreground">
            No chats yet. Create a character and start your first conversation!
          </p>
        </div>
      )}
    </div>
  )
}
