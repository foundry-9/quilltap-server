'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { TagDisplay } from '@/components/tags/tag-display'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { useQuickHide } from '@/components/providers/quick-hide-provider'

interface RecentChat {
  id: string
  title: string
  updatedAt: string | Date
  messageCount: number
  character: {
    name: string
    avatarUrl?: string | null
    defaultImageId?: string | null
    defaultImage?: {
      id: string
      filepath: string
      url?: string | null
    } | null
  }
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

function getAvatarSrc(chat: RecentChat): string | null {
  if (chat.character.defaultImage) {
    // Handle filepath - check if it already has a leading slash (e.g., S3 files use /api/files/...)
    const filepath = chat.character.defaultImage.filepath
    return chat.character.defaultImage.url || (filepath.startsWith('/') ? filepath : `/${filepath}`)
  }
  return chat.character.avatarUrl || null
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
          {visibleChats.map((chat) => (
            <Link
              key={chat.id}
              href={`/chats/${chat.id}`}
              className="block rounded-lg border border-border bg-card p-4 shadow-sm hover:border-primary transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-4 flex-grow">
                  {getAvatarSrc(chat) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={getAvatarSrc(chat)!}
                      alt={chat.character.name}
                      width={64}
                      height={64}
                      className={getAvatarClasses(style, 'lg').imageClass}
                    />
                  ) : (
                    <div className={getAvatarClasses(style, 'lg').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
                      <span className={getAvatarClasses(style, 'lg').fallbackClass}>
                        {chat.character.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
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
                      with {chat.character.name}
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
          ))}
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
