'use client'

/**
 * CharactersSection
 *
 * Client component displaying a 2x2 grid of favorite characters on the homepage.
 */

import { useMemo } from 'react'
import Link from 'next/link'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { CharacterCard } from './CharacterCard'
import type { CharactersSectionProps } from './types'

export function CharactersSection({ characters }: CharactersSectionProps) {
  const { shouldHideByIds } = useQuickHide()

  // Filter out hidden characters
  const visibleCharacters = useMemo(
    () => characters.filter(character => !shouldHideByIds(character.tags || [])),
    [characters, shouldHideByIds]
  )

  return (
    <div className="qt-homepage-section">
      <div className="qt-homepage-section-header">
        <h2 className="qt-homepage-section-title">Your Characters</h2>
        <Link href="/characters" className="qt-homepage-section-link">
          Manage &rarr;
        </Link>
      </div>
      <div className="qt-homepage-section-content">
        {visibleCharacters.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <p className="text-sm">No favorite characters</p>
            <Link href="/characters" className="text-xs text-primary hover:underline">
              Mark some as favorites
            </Link>
          </div>
        ) : (
          <div className="qt-characters-grid">
            {visibleCharacters.slice(0, 4).map(character => (
              <CharacterCard key={character.id} character={character} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
