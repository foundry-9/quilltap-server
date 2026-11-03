'use client'

/**
 * Chat Header Breadcrumb
 *
 * The Salon's left-hand toolbar row: project / characters / story background /
 * Concierge badge / chat title. A crowded chat has more names than the header
 * has room for, so the project and character links step down through three
 * densities until the row fits:
 *
 *   full    — avatar + full name
 *   abbrev  — avatar + short abbreviation
 *   avatar  — avatar alone
 *
 * The compact forms carry a Quilltap tooltip with the full name. The story
 * background and the title never compact; the title truncates as a last resort.
 *
 * Each density is laid out once in an invisible measuring copy so the choice
 * never depends on the row's own (already compacted) width.
 *
 * @module components/chat/ChatHeaderBreadcrumb
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/components/ui/icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { CopyChatIdButton } from '@/components/chat/CopyChatIdButton'

export type BreadcrumbDensity = 'full' | 'abbrev' | 'avatar'

const DENSITIES: BreadcrumbDensity[] = ['full', 'abbrev', 'avatar']

/** Widest the title may be counted as when choosing a density; past this it truncates */
const TITLE_MEASURE_MAX_PX = 256

/** Words that carry no weight in an initialism ("Voyages of the Covenant" → "VC") */
const MINOR_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'in', 'on', 'at', 'to', 'for'])

/**
 * Short form of a name for the compact header. One word keeps its first three
 * letters ("Abigail" → "Abi"); several words become their initials, minor words
 * dropped ("Baraka Ilunga" → "BI"), at most four letters.
 */
export function abbreviateName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (words.length === 1) {
    const chars = Array.from(words[0])
    return chars.length <= 4 ? words[0] : chars.slice(0, 3).join('')
  }
  const significant = words.filter(w => !MINOR_WORDS.has(w.toLowerCase()))
  const source = significant.length > 0 ? significant : words
  return source
    .slice(0, 4)
    .map(w => Array.from(w)[0].toUpperCase())
    .join('')
}

/** First density whose natural width fits, or the most compact one */
export function chooseDensity(
  available: number,
  widths: Record<BreadcrumbDensity, number>,
): BreadcrumbDensity {
  return DENSITIES.find(d => widths[d] <= available) ?? 'avatar'
}

export interface ChatHeaderCharacter {
  id: string
  name: string
  avatarUrl: string | null
}

export interface ChatHeaderBreadcrumbProps {
  chatId: string
  title: string
  project?: { id: string; name: string } | null
  characters: ChatHeaderCharacter[]
  /** Thumbnail of the story background, when one is visible */
  storyBackgroundUrl?: string | null
  onOpenStoryBackground?: () => void
  /** The Concierge pill, when the chat is not Moderated */
  conciergeBadge?: ReactNode
}

function CompactTip({ name, hint, children }: { name: string; hint: string; children: ReactNode }) {
  return (
    <Tooltip
      placement="bottom"
      anchorClassName="flex-shrink-0"
      content={
        <div className="qt-tooltip-body">
          <p className="qt-tooltip-title">{name}</p>
          <p className="qt-tooltip-hint">{hint}</p>
        </div>
      }
    >
      {children}
    </Tooltip>
  )
}

function CharacterAvatar({ character }: { character: ChatHeaderCharacter }) {
  if (character.avatarUrl) {
    return (
      <img
        src={character.avatarUrl}
        alt=""
        className="w-5 h-5 rounded-full object-cover flex-shrink-0"
      />
    )
  }
  return (
    <span className="w-5 h-5 rounded-full qt-bg-muted flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-medium qt-text-secondary">
        {character.name.charAt(0).toUpperCase()}
      </span>
    </span>
  )
}

interface RowProps extends ChatHeaderBreadcrumbProps {
  density: BreadcrumbDensity
  /** The invisible measuring copy: no tooltips, no focusable links, title capped */
  measuring?: boolean
}

function BreadcrumbRow({
  density,
  measuring = false,
  chatId,
  title,
  project,
  characters,
  storyBackgroundUrl,
  onOpenStoryBackground,
  conciergeBadge,
}: RowProps) {
  const compact = density !== 'full'
  const linkClass = 'inline-flex items-center gap-1.5 qt-text-secondary hover:text-foreground transition-colors flex-shrink-0'
  const tabIndex = measuring ? -1 : undefined

  const withTip = (name: string, hint: string, node: ReactNode) =>
    compact && !measuring ? <CompactTip name={name} hint={hint}>{node}</CompactTip> : node

  const projectLink = project && (
    <a
      href={`/projects/${project.id}`}
      className={linkClass}
      aria-label={compact ? `Project: ${project.name}` : undefined}
      tabIndex={tabIndex}
    >
      <Icon name="folder" className="w-4 h-4" />
      {density === 'full' && <span>{project.name}</span>}
      {density === 'abbrev' && <span aria-hidden="true">{abbreviateName(project.name)}</span>}
    </a>
  )

  const titleLink = (
    <a
      href={`/salon/${chatId}`}
      className="qt-text-primary truncate min-w-0 hover:text-foreground transition-colors"
      style={measuring ? { maxWidth: TITLE_MEASURE_MAX_PX, display: 'inline-block' } : undefined}
      tabIndex={tabIndex}
    >
      {title}
    </a>
  )

  return (
    <>
      {/* Clips only once the title is down to its floor */}
      {(project || characters.length > 0) && (
        <span className="flex items-center gap-2 min-w-0 overflow-hidden">
          {project && (
            <>
              {withTip(project.name, 'Click to open project', projectLink)}
              <span className="qt-text-muted flex-shrink-0">/</span>
            </>
          )}
          {characters.map((character) => (
            <span key={character.id} className="contents">
              {withTip(
                character.name,
                'Click to open character',
                <a
                  href={`/aurora/${character.id}/view?tab=conversations`}
                  className={linkClass}
                  aria-label={compact ? character.name : undefined}
                  tabIndex={tabIndex}
                >
                  <CharacterAvatar character={character} />
                  {density === 'full' && <span>{character.name}</span>}
                  {density === 'abbrev' && <span aria-hidden="true">{abbreviateName(character.name)}</span>}
                </a>,
              )}
              <span className="qt-text-muted flex-shrink-0">/</span>
            </span>
          ))}
        </span>
      )}
      {storyBackgroundUrl && (() => {
        const button = (
          <button
            type="button"
            onClick={measuring ? undefined : onOpenStoryBackground}
            className="flex-shrink-0 rounded overflow-hidden hover:ring-2 hover:ring-primary/50 transition-all"
            aria-label="Display story background"
            tabIndex={tabIndex}
          >
            <img src={storyBackgroundUrl} alt="" className="w-8 h-5 object-cover" />
          </button>
        )
        return measuring ? button : (
          <Tooltip content="Click to display background" placement="bottom" anchorClassName="flex-shrink-0">
            {button}
          </Tooltip>
        )
      })()}
      {conciergeBadge}
      {measuring ? titleLink : (
        <Tooltip content={title} placement="bottom" anchorClassName="min-w-32 shrink-[1000]">
          {titleLink}
        </Tooltip>
      )}
      <CopyChatIdButton chatId={chatId} variant="inline" />
    </>
  )
}

export function ChatHeaderBreadcrumb(props: ChatHeaderBreadcrumbProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const measureRefs = useRef<Record<BreadcrumbDensity, HTMLDivElement | null>>({
    full: null,
    abbrev: null,
    avatar: null,
  })
  const [density, setDensity] = useState<BreadcrumbDensity>('full')

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const recompute = () => {
      const available = container.clientWidth
      // Hidden below md — nothing to fit.
      if (available === 0) return
      const widths = {} as Record<BreadcrumbDensity, number>
      for (const d of DENSITIES) {
        widths[d] = measureRefs.current[d]?.scrollWidth ?? 0
      }
      setDensity(chooseDensity(available, widths))
    }

    recompute()
    const observer = new ResizeObserver(recompute)
    observer.observe(container)
    for (const d of DENSITIES) {
      const el = measureRefs.current[d]
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      className="hidden md:flex relative items-center gap-2 text-sm min-w-0 w-full overflow-hidden"
    >
      <BreadcrumbRow {...props} density={density} />
      {DENSITIES.map(d => (
        <div
          key={d}
          ref={el => { measureRefs.current[d] = el }}
          className="absolute left-0 top-0 flex items-center gap-2 w-max invisible pointer-events-none whitespace-nowrap"
          aria-hidden="true"
          inert
        >
          <BreadcrumbRow {...props} density={d} measuring />
        </div>
      ))}
    </div>
  )
}
