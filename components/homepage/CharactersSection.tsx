'use client'

/**
 * CharactersSection
 *
 * Client component displaying a grid of characters on the homepage.
 * Uses a resize observer to only show characters that fit completely.
 */

import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { CharacterCard } from './CharacterCard'
import type { CharactersSectionProps } from './types'

// Card dimensions for calculating grid fit
const CARD_WIDTH_ESTIMATE = 150 // Card max width
const CARD_HEIGHT_ESTIMATE = 185 // Card height including 2-line description
const GRID_GAP = 12 // gap-3 = 0.75rem = 12px
// Minimum characters to show even if they don't all fit
const MIN_CHARACTERS = 2

export function CharactersSection({ characters }: CharactersSectionProps) {
  const { shouldHideByIds } = useQuickHide()
  const containerRef = useRef<HTMLDivElement>(null)
  const [maxCards, setMaxCards] = useState<number | null>(null)

  // Filter out hidden characters
  const visibleCharacters = useMemo(
    () => characters.filter(character => !shouldHideByIds(character.tags || [])),
    [characters, shouldHideByIds]
  )

  // Calculate how many character cards can fit based on container dimensions
  const calculateFittingCards = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const availableWidth = container.clientWidth
    const availableHeight = container.clientHeight

    // Calculate columns: how many cards fit horizontally
    // Each card needs CARD_WIDTH + GAP (except last card doesn't need trailing gap)
    const columnsCanFit = Math.max(2, Math.floor((availableWidth + GRID_GAP) / (CARD_WIDTH_ESTIMATE + GRID_GAP)))

    // Calculate rows: how many complete rows fit vertically
    const rowsCanFit = Math.max(1, Math.floor((availableHeight + GRID_GAP) / (CARD_HEIGHT_ESTIMATE + GRID_GAP)))

    const cardsCanFit = Math.max(MIN_CHARACTERS, rowsCanFit * columnsCanFit)
    setMaxCards(cardsCanFit)
  }, [])

  // Use ResizeObserver to recalculate when container size changes
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Initial calculation
    calculateFittingCards()

    // ResizeObserver may not be available in test environments
    if (typeof ResizeObserver === 'undefined') return

    const resizeObserver = new ResizeObserver(() => {
      calculateFittingCards()
    })

    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [calculateFittingCards])

  // Only show characters that fit
  const displayedCharacters = useMemo(() => {
    if (maxCards === null) return visibleCharacters.slice(0, 4) // Default to 4 until measured
    return visibleCharacters.slice(0, maxCards)
  }, [visibleCharacters, maxCards])

  return (
    <div className="qt-homepage-section">
      <div className="qt-homepage-section-header">
        <h2 className="qt-homepage-section-title">Characters</h2>
        <Link href="/characters" className="qt-homepage-section-link">
          View all &rarr;
        </Link>
      </div>
      <div ref={containerRef} className="qt-homepage-section-content">
        {visibleCharacters.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <p className="text-sm">No favorite characters</p>
            <Link href="/characters" className="text-xs text-primary hover:underline">
              Mark some as favorites
            </Link>
          </div>
        ) : (
          <div className="qt-characters-grid">
            {displayedCharacters.map(character => (
              <CharacterCard key={character.id} character={character} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
