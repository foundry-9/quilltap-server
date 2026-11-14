'use client'

/**
 * The character page's sticky header.
 *
 * Line 1 the name; line 2 title · pronouns · age · kind and the state badges
 * (NPC, user-controlled, archived), with the save status at the right; line 3
 * aliases and group chips; line 4 the stats, every figure a link to where the
 * thing lives. One primary action (Start Chat), one **Generate ▾** menu for
 * the three things that write *into* the character with a model, one **⋯**
 * overflow for lifecycle, and the favourite star. The avatar is a menu:
 * choose from photos, upload, or generate a portrait.
 *
 * Settings are not toggled here — Carina and user-control live in Abilities;
 * the header shows their state as badges only.
 *
 * @module app/aurora/[id]/CharacterHeader
 */

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { ItemActionMenu } from '@/components/item-browser/ItemActionMenu'
import type { AvatarDisplayStyle } from '@/lib/avatar-styles'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { ageOn, dateStampIn } from '@/lib/characters/birthday'
import { isAssistantCharacter } from '@/lib/characters/kind'
import type { CharacterPageSection } from '@/lib/characters/page-sections'
import { SaveStatusChip } from './components/SaveStatusChip'
import { useCharacterPage } from './CharacterPageContext'

export interface CharacterHeaderProps {
  avatarStyle: AvatarDisplayStyle
  rehydrating: boolean
  onBack: () => void
  onStartChat: () => void
  onChooseAvatar: () => void
  onUploadAvatar: () => void
  onGeneratePortrait: () => void
  onOpenWardrobe: () => void
  onOpenInventory: () => void
  onAIWizard: () => void
  onOptimize: () => void
  onExternalPrompt: () => void
  onExport: () => void
  onToggleNpc: () => void
  onToggleFavorite: () => void
  onArchive: () => void
  onRehydrate: () => void
  onDelete: () => void
}

function avatarSrcOf(character: {
  defaultImage?: { filepath: string; url?: string }
  avatarUrl?: string
  defaultImageId?: string
}): string | null {
  let src: string | null = null
  if (character.defaultImage) {
    const filepath = character.defaultImage.filepath
    src = character.defaultImage.url || (filepath.startsWith('/') ? filepath : `/${filepath}`)
  } else {
    src = character.avatarUrl || null
  }
  if (src && character.defaultImageId) {
    src = `${src}${src.includes('?') ? '&' : '?'}v=${character.defaultImageId}`
  }
  return src
}

function Badge({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full border qt-border-default qt-bg-muted px-2 py-0.5 text-xs font-medium qt-text-secondary"
    >
      {children}
    </span>
  )
}

/** Smallest and largest the header avatar may be, in px. */
const AVATAR_MIN_PX = 96
const AVATAR_MAX_PX = 240

/**
 * The avatar's edge: the height of the text column beside it, clamped. A
 * square sized by percentage height cannot feed its width back into the flex
 * row (the percentage resolves after the row has measured its items), so the
 * column is measured instead and the avatar follows it as it grows or wraps.
 */
function useAvatarEdge() {
  const columnRef = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState(AVATAR_MIN_PX)
  useEffect(() => {
    const column = columnRef.current
    if (!column || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const next = Math.round(Math.min(AVATAR_MAX_PX, Math.max(AVATAR_MIN_PX, column.offsetHeight)))
      setEdge((prev) => (prev === next ? prev : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(column)
    return () => observer.disconnect()
  }, [])
  return { columnRef, edge }
}

export function CharacterHeader(props: CharacterHeaderProps) {
  const { character, autosave, stats, groups, vault, readOnly, goToSection } = useCharacterPage()
  const [today] = useState(() => dateStampIn(Date.now()))
  const age = character.birthday ? ageOn(character.birthday, today) : null
  const avatarSrc = avatarSrcOf(character)
  const archived = Boolean(character.archivedAt)

  const statLink = (section: CharacterPageSection, anchor: string) => () => goToSection(section, anchor)
  type Stat = { key: string; value: ReactNode; label: string; tip: string; onClick?: () => void; href?: string }
  const statItems: Stat[] = stats
    ? [
        {
          key: 'memories',
          value: stats.memories,
          label: stats.memories === 1 ? 'memory' : 'memories',
          tip: "Entries in this character's Commonplace Book.",
          onClick: statLink('history', 'memories'),
        },
        {
          key: 'conversations',
          value: stats.conversations,
          label: stats.conversations === 1 ? 'conversation' : 'conversations',
          tip: 'Chats this character has taken part in.',
          onClick: statLink('history', 'conversations'),
        },
        {
          key: 'wardrobe',
          value: stats.wardrobeItems,
          label: stats.wardrobeItems === 1 ? 'wardrobe item' : 'wardrobe items',
          tip: "Garments and accessories in this character's own wardrobe. Opens the wardrobe.",
          onClick: props.onOpenWardrobe,
        },
        ...(stats.inventory
          ? ([
              {
                key: 'inventory-objects',
                value: stats.inventory.objects,
                label: stats.inventory.objects === 1 ? 'object' : 'objects',
                tip: "Objects (not archetypes or kits) on this character's own Inventory shelf. Opens the inventory.",
                onClick: props.onOpenInventory,
              },
              {
                key: 'inventory-carried',
                value: stats.inventory.carriedByDefault,
                label: 'carried by default',
                tip: 'Objects and kits flagged to arrive in every chat with this character. Opens the inventory.',
                onClick: props.onOpenInventory,
              },
              {
                key: 'inventory-archetypes',
                value: stats.inventory.archetypes,
                label: stats.inventory.archetypes === 1 ? 'archetype' : 'archetypes',
                tip: 'Classes of object on the shelf; never carried themselves, instances derive from them. Opens the inventory.',
                onClick: props.onOpenInventory,
              },
              {
                key: 'inventory-kits',
                value: stats.inventory.kits,
                label: stats.inventory.kits === 1 ? 'kit' : 'kits',
                tip: 'Kits on the shelf: lists of objects equipped as one. Opens the inventory.',
                onClick: props.onOpenInventory,
              },
            ] satisfies Stat[])
          : []),
        {
          key: 'photos',
          value: stats.photos,
          label: stats.photos === 1 ? 'photo' : 'photos',
          tip: "Portraits saved in this character's gallery.",
          onClick: statLink('appearance', 'photos'),
        },
        {
          key: 'scenarios',
          value: stats.scenarios,
          label: stats.scenarios === 1 ? 'scenario' : 'scenarios',
          tip: 'Scene-setting openers a chat can begin in.',
          onClick: statLink('prompts', 'scenarios'),
        },
        {
          key: 'knowledge',
          value: stats.knowledge,
          label: 'knowledge',
          tip: "Documents in the vault's Knowledge folder. Opens the vault in the Scriptorium.",
          href: vault ? `/scriptorium/${vault.mountPointId}` : undefined,
        },
        {
          key: 'core',
          value: stats.core,
          label: 'core',
          tip: "Documents in the vault's Core folder. Opens the vault in the Scriptorium.",
          href: vault ? `/scriptorium/${vault.mountPointId}` : undefined,
        },
        {
          key: 'characterFiles',
          value: `${stats.characterFiles}/${stats.characterFilesTotal}`,
          label: 'character files',
          tip: 'How many of the canonical managed vault files are present. Shows the Vault card.',
          onClick: statLink('details', 'vault'),
        },
      ]
    : []

  const avatarClasses = getAvatarClasses(props.avatarStyle, 'lg')
  const { columnRef, edge } = useAvatarEdge()

  return (
    <div className="sticky top-0 z-20 mb-4 border-b qt-border-default qt-bg-card/90 px-1 pb-3 pt-3 backdrop-blur">
      <button
        type="button"
        onClick={props.onBack}
        className="mb-2 inline-flex items-center qt-action"
      >
        ← Back to Characters
      </button>
      <div className="flex flex-wrap items-start gap-4">
        {/* Avatar — a menu, not a pencil. As tall as the text beside it and
            square: the largest the avatar is shown anywhere short of a
            picture viewer. */}
        <div className="flex-shrink-0" style={{ width: edge, maxWidth: '100%', aspectRatio: '1 / 1' }}>
          <ItemActionMenu
            label={`Change ${character.name}'s avatar`}
            disabled={readOnly}
            minWidthClass="min-w-[13rem]"
            containerClassName="h-full w-full"
            trigger={{
              ariaLabel: `Change ${character.name}'s avatar`,
              title: 'Change avatar',
              className: `relative block h-full w-full overflow-hidden ${props.avatarStyle === 'CIRCULAR' ? 'rounded-full' : 'rounded-lg'} focus:outline-none focus:ring-2 qt-focus-ring`,
              content: avatarSrc ? (
                <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center qt-bg-muted">
                  <span className={avatarClasses.fallbackClass}>{character.name.charAt(0).toUpperCase() || '?'}</span>
                </span>
              ),
            }}
            entries={[
              { key: 'choose', label: 'Choose from photos…', onSelect: props.onChooseAvatar },
              { key: 'upload', label: 'Upload…', onSelect: props.onUploadAvatar },
              { key: 'generate', label: 'Generate portrait…', onSelect: props.onGeneratePortrait },
            ]}
          />
        </div>

        <div ref={columnRef} className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="qt-heading-1 min-w-0 break-words">{character.name}</h1>
            {!archived && (
              <button
                type="button"
                onClick={props.onToggleFavorite}
                className="text-2xl qt-text-favorite transition-transform hover:scale-110 inline-flex min-h-6 min-w-6 items-center justify-center"
                title={character.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                aria-label="Favorite"
                aria-pressed={!!character.isFavorite}
              >
                <span aria-hidden="true">{character.isFavorite ? '⭐' : '☆'}</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 qt-text-small qt-text-secondary">
              {[
                character.title ? <span key="title">{character.title}</span> : null,
                character.pronouns ? (
                  <span key="pronouns" title="Pronouns">
                    {character.pronouns.subject}/{character.pronouns.object}/{character.pronouns.possessive}
                  </span>
                ) : null,
                age !== null ? (
                  <span key="age" title={`Born ${character.birthday}`}>
                    {age} {age === 1 ? 'year' : 'years'} old
                  </span>
                ) : null,
              ]
                .filter(Boolean)
                .map((node, i) => (
                  <Fragment key={i}>
                    {i > 0 && <span aria-hidden="true">·</span>}
                    {node}
                  </Fragment>
                ))}
              <Badge title="Kind of character (Details)">{isAssistantCharacter(character) ? 'Assistant' : 'Roleplay'}</Badge>
              {character.npc && <Badge title="A non-player character (Abilities)">NPC</Badge>}
              {character.controlledBy === 'user' && <Badge title="You play this character (Abilities)">User-controlled</Badge>}
              {character.canBeCarina && <Badge title="Answers @-queries (Abilities)">Carina</Badge>}
              {archived && (
                <Badge title={`Resting in the archive since ${new Date(character.archivedAt!).toLocaleDateString()}`}>
                  Archived
                </Badge>
              )}
            </div>
            <SaveStatusChip engine={autosave.engine} />
          </div>

          {((character.aliases?.length ?? 0) > 0 || groups.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {character.aliases?.map((alias, i) => (
                <Badge key={`${alias}-${i}`}>{alias}</Badge>
              ))}
              {groups.map((g) => (
                <Link
                  key={g.id}
                  href={`/aurora/groups/${g.id}`}
                  title={`${g.description?.trim() || g.name} — membership is managed on the group's page`}
                  className="group inline-flex items-center gap-1.5 rounded-full border qt-border-default qt-bg-muted px-2 py-0.5 text-xs font-medium qt-text transition hover:qt-border-primary/50"
                >
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none"
                    style={{ backgroundColor: g.color || 'var(--color-muted)' }}
                  >
                    {g.icon || ''}
                  </span>
                  <span>{g.name}</span>
                  <span className="hidden qt-text-secondary group-hover:inline">Manage ↗</span>
                </Link>
              ))}
            </div>
          )}

          {statItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 qt-text-small qt-text-secondary">
              {statItems.map((s, i) => (
                <Fragment key={s.key}>
                  {i > 0 && (
                    <span className="opacity-40" aria-hidden>
                      |
                    </span>
                  )}
                  {s.href ? (
                    <Link href={s.href} title={s.tip} className="hover:underline">
                      <strong className="font-semibold qt-text">{s.value}</strong> {s.label}
                    </Link>
                  ) : s.onClick ? (
                    <button type="button" onClick={s.onClick} title={s.tip} className="hover:underline">
                      <strong className="font-semibold qt-text">{s.value}</strong> {s.label}
                    </button>
                  ) : (
                    <span title={s.tip}>
                      <strong className="font-semibold qt-text">{s.value}</strong> {s.label}
                    </span>
                  )}
                </Fragment>
              ))}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {archived ? (
            <button
              type="button"
              onClick={props.onRehydrate}
              disabled={props.rehydrating}
              className="qt-button-primary"
              title="Restore this character from their archive bundle and wake them"
            >
              {props.rehydrating ? 'Rehydrating…' : 'Rehydrate'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={props.onStartChat}
                className="inline-flex items-center justify-center rounded-lg qt-bg-success px-4 py-2 text-sm font-semibold qt-text-on-success shadow hover:qt-bg-success/90"
              >
                Start Chat
              </button>
              <ItemActionMenu
                label="Generate"
                minWidthClass="min-w-[17rem]"
                trigger={{
                  content: (
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="wand" className="h-4 w-4" />
                      Generate
                      <span aria-hidden="true">▾</span>
                    </span>
                  ),
                  className: 'qt-button-secondary',
                }}
                entries={[
                  { key: 'wizard', label: 'AI Wizard…', onSelect: props.onAIWizard },
                  { key: 'optimize', label: 'Refine from memories & instructions…', onSelect: props.onOptimize },
                  { key: 'external', label: 'Non-Quilltap prompt…', onSelect: props.onExternalPrompt },
                ]}
              />
            </>
          )}
          <ItemActionMenu
            label="More actions"
            minWidthClass="min-w-[14rem]"
            trigger={{
              content: <span aria-hidden="true">⋯</span>,
              ariaLabel: 'More actions',
              className: 'qt-button-secondary',
            }}
            entries={[
              !archived && { key: 'export', label: 'Export…', onSelect: props.onExport },
              !archived && {
                key: 'npc',
                label: character.npc ? 'Convert to character' : 'Convert to NPC',
                onSelect: props.onToggleNpc,
              },
              !archived && { key: 'archive', label: 'Archive…', onSelect: props.onArchive },
              { key: 'delete', label: 'Delete…', onSelect: props.onDelete, destructive: true },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
