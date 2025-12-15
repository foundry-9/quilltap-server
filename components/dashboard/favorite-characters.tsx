'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { useQuickHide } from '@/components/providers/quick-hide-provider'

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

function getAvatarSrc(character: FavoriteCharacter): string | null {
  if (character.defaultImage) {
    // Handle filepath - check if it already has a leading slash (e.g., S3 files use /api/files/...)
    const filepath = character.defaultImage.filepath
    return character.defaultImage.url || (filepath.startsWith('/') ? filepath : `/${filepath}`)
  }
  return character.avatarUrl || null
}

export function FavoriteCharactersSection({ characters }: FavoriteCharactersProps) {
  const { style } = useAvatarDisplay()
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
            {getAvatarSrc(character) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getAvatarSrc(character)!}
                alt={character.name}
                width={40}
                height={40}
                className={`${getAvatarClasses(style, 'sm').imageClass} flex-shrink-0`}
              />
            ) : (
              <div className={`${getAvatarClasses(style, 'sm').wrapperClass} flex-shrink-0`} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5', width: '40px' } : undefined}>
                <span className={getAvatarClasses(style, 'sm').fallbackClass}>
                  {character.name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <div className={`flex flex-col min-w-0 flex-1 ${!character.title ? 'justify-center' : ''}`}>
              <h3 className="text-xs font-semibold text-foreground truncate">
                {character.name}
              </h3>
              {character.title && (
                <p className="text-[10px] text-muted-foreground truncate">
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
            {getAvatarSrc(character) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getAvatarSrc(character)!}
                alt={character.name}
                width={80}
                height={80}
                className={getAvatarClasses(style, 'lg').imageClass}
              />
            ) : (
              <div className={getAvatarClasses(style, 'lg').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
                <span className={getAvatarClasses(style, 'lg').fallbackClass}>
                  {character.name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <h3 className="text-sm font-semibold text-foreground text-center truncate w-full px-1">
              {character.name}
            </h3>
            {character.title && (
              <p className="text-xs text-muted-foreground text-center truncate w-full px-1">
                {character.title}
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
