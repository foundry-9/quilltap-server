'use client'

import type { AvatarDisplayStyle } from '@/lib/avatar-styles'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { Character } from '../types'

interface CharacterHeaderProps {
  character: Character | null
  style: AvatarDisplayStyle
  avatarRefreshKey: number
  onStartChat: () => void
  onToggleNpc: () => void
  onSearchReplace?: () => void
  togglingNpc?: boolean
}

export function CharacterHeader({
  character,
  style,
  avatarRefreshKey,
  onStartChat,
  onToggleNpc,
  onSearchReplace,
  togglingNpc = false,
}: CharacterHeaderProps) {
  const getAvatarSrc = () => {
    let src = null
    if (character?.defaultImage) {
      const filepath = character.defaultImage.filepath
      src = character.defaultImage.url || (filepath.startsWith('/') ? filepath : `/${filepath}`)
    } else {
      src = character?.avatarUrl
    }
    if (src && character?.defaultImageId) {
      const separator = src.includes('?') ? '&' : '?'
      src = `${src}${separator}v=${character.defaultImageId}`
    }
    return src
  }

  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-6 rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm">
      <div className="flex flex-grow items-center gap-4">
        <div className="relative">
          {getAvatarSrc() ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${character?.defaultImageId || 'no-image'}-${avatarRefreshKey}`}
              src={getAvatarSrc()!}
              alt={character?.name || ''}
              className={getAvatarClasses(style, 'lg').imageClass}
            />
          ) : (
            <div className={getAvatarClasses(style, 'lg').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
              <span className={getAvatarClasses(style, 'lg').fallbackClass}>
                {character?.name?.charAt(0)?.toUpperCase() || '?'}
              </span>
            </div>
          )}
        </div>
        <div>
          <h1 className="text-3xl font-semibold">
            {character?.name || 'Loading...'}
          </h1>
          {character?.title && (
            <p className="qt-text-small">{character.title}</p>
          )}
        </div>
      </div>
      <div className="flex flex-shrink-0 flex-col gap-2">
        <button
          onClick={onStartChat}
          className="inline-flex items-center justify-center rounded-lg bg-success px-4 py-2 text-sm font-semibold text-success-foreground shadow hover:bg-success/90"
        >
          Start Chat
        </button>
        <button
          onClick={onToggleNpc}
          disabled={togglingNpc}
          className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted disabled:opacity-50"
        >
          {togglingNpc ? 'Converting...' : character?.npc ? 'Convert to Character' : 'Convert to NPC'}
        </button>
        {onSearchReplace && (
          <button
            onClick={onSearchReplace}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted"
            title="Search & Replace across all chats and memories for this character"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Search & Replace
          </button>
        )}
      </div>
    </div>
  )
}
