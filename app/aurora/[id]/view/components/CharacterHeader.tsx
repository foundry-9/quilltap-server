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
  onToggleFavorite: () => void
  onToggleControlledBy: () => void
  onSearchReplace?: () => void
  onOptimize?: () => void
  onGenerateExternalPrompt?: () => void
  togglingNpc?: boolean
  togglingFavorite?: boolean
  togglingControlledBy?: boolean
}

export function CharacterHeader({
  character,
  style,
  avatarRefreshKey,
  onStartChat,
  onToggleNpc,
  onToggleFavorite,
  onToggleControlledBy,
  onSearchReplace,
  onOptimize,
  onGenerateExternalPrompt,
  togglingNpc = false,
  togglingFavorite = false,
  togglingControlledBy = false,
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
    <div className="mb-8 flex flex-wrap items-start justify-between gap-6 rounded-2xl border qt-border-default/60 qt-bg-card/80 p-6 qt-shadow-sm">
      <div className="flex flex-grow items-center gap-4">
        <div className="relative">
          {getAvatarSrc() ? (
             
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
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold">
              {character?.name || 'Loading...'}
              {character?.aliases && character.aliases.length > 0 && (
                <span className="text-lg font-normal qt-text-secondary ml-2">({character.aliases.join(' / ')})</span>
              )}
              {character?.pronouns && (
                <span className="text-lg font-normal qt-text-secondary ml-2">({character.pronouns.subject}/{character.pronouns.object}/{character.pronouns.possessive})</span>
              )}
            </h1>
            <button
              onClick={onToggleFavorite}
              disabled={togglingFavorite}
              className="text-2xl qt-text-favorite transition-transform hover:scale-110 disabled:opacity-50"
              title={character?.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              {character?.isFavorite ? '⭐' : '☆'}
            </button>
            <button
              onClick={onToggleControlledBy}
              disabled={togglingControlledBy}
              className="qt-text-favorite transition-transform hover:scale-110 disabled:opacity-50"
              title={character?.controlledBy === 'user' ? 'Switch to LLM control' : 'Switch to user control'}
            >
              {character?.controlledBy === 'user' ? (
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
              ) : (
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              )}
            </button>
          </div>
          {character?.title && (
            <p className="qt-text-small">{character.title}</p>
          )}
        </div>
      </div>
      <div className="flex flex-shrink-0 flex-col gap-2">
        <button
          onClick={onStartChat}
          className="inline-flex items-center justify-center rounded-lg bg-success px-4 py-2 text-sm font-semibold qt-text-success-foreground shadow hover:qt-bg-success/90"
        >
          Start Chat
        </button>
        <button
          onClick={onToggleNpc}
          disabled={togglingNpc}
          className="inline-flex items-center justify-center rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm font-medium text-foreground qt-shadow-sm hover:qt-bg-muted disabled:opacity-50"
        >
          {togglingNpc ? 'Converting...' : character?.npc ? 'Convert to Character' : 'Convert to NPC'}
        </button>
        {onGenerateExternalPrompt && (
          <button
            onClick={onGenerateExternalPrompt}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm font-medium text-foreground qt-shadow-sm hover:qt-bg-muted"
            title="Generate a standalone system prompt for use in external tools"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Non-Quilltap Prompt
          </button>
        )}
        {onOptimize && (
          <button
            onClick={onOptimize}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm font-medium text-foreground qt-shadow-sm hover:qt-bg-muted"
            title="Analyze memories and suggest character refinements"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Refine from Memories
          </button>
        )}
        {onSearchReplace && (
          <button
            onClick={onSearchReplace}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm font-medium text-foreground qt-shadow-sm hover:qt-bg-muted"
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
