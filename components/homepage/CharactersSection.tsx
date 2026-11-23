'use client'

/**
 * CharactersSection
 *
 * The company: a wall of portraits, favourites first and then the most
 * called-upon, two rows deep. The width decides how many fit; the last place
 * goes to a tile for everyone else.
 */

import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { CharacterCard } from './CharacterCard'
import type { CharactersSectionProps } from './types'

/** Narrowest a portrait tile gets, where the grid's own tracks cannot be read. */
const PORTRAIT_MIN_WIDTH = 96
/** Gap between tiles, likewise. */
const PORTRAIT_GAP = 8
/** Rows of portraits shown; a wall three or fewer abreast (a phone) gets a third. */
const PORTRAIT_ROWS = 2
const NARROW_WALL_COLUMNS = 3
const NARROW_WALL_ROWS = 3
/** Columns assumed until the wall has been measured. */
const DEFAULT_COLUMNS = 6

export function CharactersSection({ characters, total }: CharactersSectionProps) {
  const { shouldHideByIds } = useQuickHide()
  const wallRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(DEFAULT_COLUMNS)

  // Filter out hidden characters
  const visibleCharacters = useMemo(
    () => characters.filter(character => !shouldHideByIds(character.tags || [])),
    [characters, shouldHideByIds]
  )

  // How many tiles sit side by side at this width. The grid's resolved tracks
  // are the truth (an auto-fill grid lists every column, filled or not); the
  // arithmetic stands in where they cannot be read.
  const measure = useCallback(() => {
    const wall = wallRef.current
    if (!wall) return
    const grid = wall.querySelector('.qt-characters-grid')
    const tracks = grid
      ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(track => track.endsWith('px')).length
      : 0
    const byWidth = Math.floor((wall.clientWidth + PORTRAIT_GAP) / (PORTRAIT_MIN_WIDTH + PORTRAIT_GAP))
    const next = Math.max(2, tracks || byWidth)
    if (tracks === 0 && wall.clientWidth === 0) return
    setColumns(next)
  }, [])

  useEffect(() => {
    const wall = wallRef.current
    if (!wall) return

    measure()

    // ResizeObserver may not be available in test environments
    if (typeof ResizeObserver === 'undefined') return

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(wall)
    return () => resizeObserver.disconnect()
  }, [measure])

  // With quick-hide concealing someone, a head count would give them away.
  const nothingHidden = visibleCharacters.length === characters.length
  const hiddenFromWall = total - characters.length

  const rows = columns <= NARROW_WALL_COLUMNS ? NARROW_WALL_ROWS : PORTRAIT_ROWS
  const capacity = columns * rows
  const overflowing = visibleCharacters.length > capacity || hiddenFromWall > 0
  // The last place is the "everyone" tile when there is anyone left to see.
  const shown = overflowing
    ? visibleCharacters.slice(0, Math.max(1, capacity - 1))
    : visibleCharacters

  // A card opens away from the wall: below the last row, above the others.
  const lastRow = Math.floor((shown.length + (overflowing ? 1 : 0) - 1) / columns)

  return (
    <section className="qt-homepage-section" data-section="characters">
      <div className="qt-homepage-section-header">
        <h2 className="qt-homepage-section-title">The Company</h2>
        <Link href="/aurora" className="qt-homepage-section-link">
          View all &rarr;
        </Link>
      </div>
      <div ref={wallRef} className="qt-homepage-section-content">
        {visibleCharacters.length === 0 ? (
          <div className="qt-homepage-empty">
            <p className="qt-card-subtitle">No one has been engaged as yet.</p>
            <Link href="/aurora" className="text-sm qt-text-brand hover:underline">
              Make a character&rsquo;s acquaintance
            </Link>
          </div>
        ) : (
          <div className="qt-characters-grid">
            {shown.map((character, index) => (
              <CharacterCard
                key={character.id}
                character={character}
                align={index % columns >= columns / 2 ? 'end' : 'start'}
                placement={Math.floor(index / columns) < lastRow ? 'above' : 'below'}
              />
            ))}
            {overflowing && (
              <Link href="/aurora" className="qt-character-card" data-kind="all">
                <span className="qt-character-card-more">
                  <Icon name="characters" className="w-6 h-6" />
                </span>
                <span className="qt-character-card-name">
                  {nothingHidden ? `All ${total}` : 'Everyone'}
                </span>
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
