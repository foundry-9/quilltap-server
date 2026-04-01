'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import Avatar from '@/components/ui/Avatar'

interface FavoriteCharacter {
  id: string
  name: string
  title?: string | null
  defaultImageId: string | null
  defaultImage: {
    id: string
    filepath: string
    url?: string | null
  } | null
  avatarUrl: string | null
  tags?: string[]
}

interface FavoriteCharactersProps {
  characters: FavoriteCharacter[]
}

export function FavoriteCharactersSection({ characters }: FavoriteCharactersProps) {
  const { shouldHideByIds } = useQuickHide()
  const visibleCharacters = useMemo(
    () => characters.filter(character => !shouldHideByIds(character.tags || [])),
    [characters, shouldHideByIds]
  )

  if (visibleCharacters.length === 0) {
    return null
  }

  return (
    <div className="mt-8">
      <h2 className="mb-6 text-2xl font-bold text-foreground text-right sm:text-left">
        <span className="sm:hidden">Favorites</span>
        <span className="hidden sm:inline">Your Favorite Characters</span>
      </h2>
      {/* Mobile: horizontal cards, two across */}
      <div className="grid grid-cols-2 gap-2 sm:hidden">
        {visibleCharacters.map((character) => (
          <Link
            key={character.id}
            href={`/characters/${character.id}/view`}
            className="flex items-center gap-2 p-2 rounded-lg border border-border bg-card hover:border-primary hover:shadow-md transition-all"
          >
            <Avatar
              name={character.name}
              src={character}
              size="sm"
            />
            <div className={`flex flex-col min-w-0 flex-1 ${!character.title ? 'justify-center' : ''}`}>
              <h3 className="text-xs font-semibold text-foreground truncate">
                {character.name}
              </h3>
              {character.title && (
                <p className="text-[10px] truncate">
                  {character.title}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
      {/* Desktop: original grid layout */}
      <div className="hidden sm:grid sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {visibleCharacters.map((character) => (
          <Link
            key={character.id}
            href={`/characters/${character.id}/view`}
            className="flex flex-col items-center gap-4 p-4 rounded-lg border border-border bg-card hover:border-primary hover:shadow-md transition-all"
          >
            <Avatar
              name={character.name}
              src={character}
              size="lg"
            />
            <h3 className="text-sm font-semibold text-foreground text-center truncate w-full px-1">
              {character.name}
            </h3>
            {character.title && (
              <p className="qt-text-xs text-center truncate w-full px-1">
                {character.title}
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
