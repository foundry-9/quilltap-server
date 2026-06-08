'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import type { AvatarDisplayStyle } from '@/lib/avatar-styles'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { Character, CharacterStats, GroupBadge } from '../types'

interface CharacterHeaderProps {
  character: Character | null
  style: AvatarDisplayStyle
  avatarRefreshKey: number
  stats?: CharacterStats | null
  groups?: GroupBadge[]
  onStartChat: () => void
  onToggleNpc: () => void
  onToggleFavorite: () => void
  onToggleControlledBy: () => void
  onToggleCarina: () => void
  onSearchReplace?: () => void
  onOptimize?: () => void
  onGenerateExternalPrompt?: () => void
  togglingNpc?: boolean
  togglingFavorite?: boolean
  togglingControlledBy?: boolean
  togglingCarina?: boolean
}

export function CharacterHeader({
  character,
  style,
  avatarRefreshKey,
  stats = null,
  groups = [],
  onStartChat,
  onToggleNpc,
  onToggleFavorite,
  onToggleControlledBy,
  onToggleCarina,
  onSearchReplace,
  onOptimize,
  onGenerateExternalPrompt,
  togglingNpc = false,
  togglingFavorite = false,
  togglingControlledBy = false,
  togglingCarina = false,
}: CharacterHeaderProps) {
  // Stat line entries in display order. `value` is the bold figure (a count,
  // or the `N/total` fraction for character files); `tip` is the hover tooltip
  // explaining what the figure represents.
  const statItems = stats
    ? [
        {
          key: 'memories',
          value: stats.memories,
          label: stats.memories === 1 ? 'memory' : 'memories',
          tip: "Entries in this character's Commonplace Book — what they remember from past conversations.",
        },
        {
          key: 'conversations',
          value: stats.conversations,
          label: stats.conversations === 1 ? 'conversation' : 'conversations',
          tip: 'Chats this character has taken part in.',
        },
        {
          key: 'wardrobe',
          value: stats.wardrobeItems,
          label: stats.wardrobeItems === 1 ? 'wardrobe item' : 'wardrobe items',
          tip: "Garments and accessories in this character's wardrobe.",
        },
        {
          key: 'photos',
          value: stats.photos,
          label: stats.photos === 1 ? 'photo' : 'photos',
          tip: "Portraits saved in this character's gallery.",
        },
        {
          key: 'scenarios',
          value: stats.scenarios,
          label: stats.scenarios === 1 ? 'scenario' : 'scenarios',
          tip: 'Scene-setting openers written for this character, so a chat can begin in a particular situation.',
        },
        {
          key: 'knowledge',
          value: stats.knowledge,
          label: 'knowledge',
          tip: "Documents in this character's vault Knowledge folder — reference material they can draw on during chats.",
        },
        {
          key: 'core',
          value: stats.core,
          label: 'core',
          tip: "Documents in this character's vault Core folder — a foundational packet that is periodically re-offered to them.",
        },
        {
          key: 'characterFiles',
          value: `${stats.characterFiles}/${stats.characterFilesTotal}`,
          label: 'character files',
          tip: `How many of the ${stats.characterFilesTotal} canonical managed vault files are present (identity, description, personality, and the like). ${stats.characterFiles}/${stats.characterFilesTotal} means the vault is complete; a shortfall means some are missing.`,
        },
      ]
    : []
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
    <div className="mb-8 grid grid-cols-[auto_1fr_auto] items-stretch gap-6 rounded-2xl border qt-border-default/60 qt-bg-card/80 p-6 qt-shadow-sm">
      {/* Avatar — grid stretches this cell to card height; image fills via absolute positioning */}
      <div className={`relative overflow-hidden ${style === 'CIRCULAR' ? 'rounded-full' : ''}`}>
        {getAvatarSrc() ? (
          <img
            key={`${character?.defaultImageId || 'no-image'}-${avatarRefreshKey}`}
            src={getAvatarSrc()!}
            alt={character?.name || ''}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-300 dark:bg-slate-700">
            <span className={getAvatarClasses(style, 'lg').fallbackClass}>
              {character?.name?.charAt(0)?.toUpperCase() || '?'}
            </span>
          </div>
        )}
        {/* Invisible sizer: height comes from grid row, width from aspect ratio */}
        <div className="invisible" style={style === 'CIRCULAR' ? { aspectRatio: '1/1', height: '100%' } : { aspectRatio: '4/5', height: '100%' }} />
      </div>
      {/* Name / title / stats / groups */}
      <div className="flex min-w-0 flex-col">
        {/* Top-aligned: name + favorite/control on one row, title + pronouns on the next */}
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-4">
            <h1 className="qt-heading-1 min-w-0">{character?.name || 'Loading...'}</h1>
            <div className="flex flex-shrink-0 items-center gap-2">
              <button
                onClick={onToggleFavorite}
                disabled={togglingFavorite}
                className="text-2xl qt-text-favorite transition-transform hover:scale-110 disabled:opacity-50"
                title={character?.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                {character?.isFavorite ? '⭐' : '☆'}
              </button>
              <button
                onClick={onToggleCarina}
                disabled={togglingCarina}
                className="qt-text-favorite transition-transform hover:scale-110 disabled:opacity-50"
                title={character?.canBeCarina ? 'Disable Carina answers (@-queries)' : 'Enable Carina answers (@-queries)'}
              >
                {character?.canBeCarina ? (
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4 3h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-5v2h2a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2h2v-2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                )}
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
          </div>
          {(character?.title || character?.pronouns) && (
            <div className="flex items-baseline justify-between gap-4">
              {character?.title ? (
                <h2 className="qt-heading-2 qt-text-secondary min-w-0">{character.title}</h2>
              ) : (
                <span />
              )}
              {character?.pronouns && (
                <span
                  className="flex-shrink-0 cursor-help qt-text-small qt-text-secondary"
                  title={`Pronouns used to refer to ${character.name || 'this character'}: ${character.pronouns.subject} (subject) / ${character.pronouns.object} (object) / ${character.pronouns.possessive} (possessive).`}
                >
                  {character.pronouns.subject}/{character.pronouns.object}/{character.pronouns.possessive}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Aliases as badges */}
        {character?.aliases && character.aliases.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {character.aliases.map((alias, i) => (
              <span
                key={`${alias}-${i}`}
                className="inline-flex items-center rounded-full border qt-border-default qt-bg-muted px-2 py-0.5 text-xs qt-text-secondary"
              >
                {alias}
              </span>
            ))}
          </div>
        )}

        {/* Bottom-aligned: stat line + group badges */}
        <div className="mt-auto space-y-2 pt-4">
          {statItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 qt-text-small qt-text-secondary">
              {statItems.map((s, i) => (
                <Fragment key={s.key}>
                  {i > 0 && <span className="opacity-40" aria-hidden>|</span>}
                  <span className="cursor-help" title={s.tip}>
                    <strong className="font-semibold text-foreground">{s.value}</strong> {s.label}
                  </span>
                </Fragment>
              ))}
            </div>
          )}
          {groups.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {groups.map((g) => (
                <Link
                  key={g.id}
                  href={`/aurora/groups/${g.id}`}
                  title={g.description?.trim() || g.name}
                  className="inline-flex items-center gap-1.5 rounded-full border qt-border-default qt-bg-muted px-2 py-0.5 text-xs font-medium text-foreground transition hover:qt-border-primary/50"
                >
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none"
                    style={{ backgroundColor: g.color || 'var(--muted)' }}
                  >
                    {g.icon || ''}
                  </span>
                  <span>{g.name}</span>
                </Link>
              ))}
            </div>
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
          className="inline-flex items-center justify-center rounded-lg border qt-border-default qt-bg-card px-4 py-2 qt-label text-foreground qt-shadow-sm hover:qt-bg-muted disabled:opacity-50"
        >
          {togglingNpc ? 'Converting...' : character?.npc ? 'Convert to Character' : 'Convert to NPC'}
        </button>
        {onGenerateExternalPrompt && (
          <button
            onClick={onGenerateExternalPrompt}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border qt-border-default qt-bg-card px-4 py-2 qt-label text-foreground qt-shadow-sm hover:qt-bg-muted"
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
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border qt-border-default qt-bg-card px-4 py-2 qt-label text-foreground qt-shadow-sm hover:qt-bg-muted"
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
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border qt-border-default qt-bg-card px-4 py-2 qt-label text-foreground qt-shadow-sm hover:qt-bg-muted"
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
