'use client'

import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import Avatar from '@/components/ui/Avatar'
import { QuickChatDialog } from './QuickChatDialog'

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
  const [chatDialogCharacter, setChatDialogCharacter] = useState<FavoriteCharacter | null>(null)


  const handleChatClick = (e: React.MouseEvent, character: FavoriteCharacter) => {
    e.preventDefault()
    e.stopPropagation()
    setChatDialogCharacter(character)
  }

  if (visibleCharacters.length === 0) {
    return null
  }

  return (
    <div className="mt-8">
      <h2 className="mb-6 text-2xl font-bold text-foreground text-center">
        <span className="sm:hidden">Favorites</span>
        <span className="hidden sm:inline">Your Favorite Characters</span>
      </h2>
      {/* Mobile: horizontal cards, two across */}
      <div className="grid grid-cols-2 gap-2 sm:hidden">
        {visibleCharacters.map((character) => (
          <div
            key={character.id}
            className="flex flex-col h-full p-2 rounded-lg border border-border bg-card"
          >
            <Link
              href={`/characters/${character.id}/view`}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <Avatar
                name={character.name}
                src={character}
                size="sm"
              />
              <div className="flex flex-col min-w-0 flex-1">
                <h3 className="text-xs font-semibold text-foreground leading-tight">
                  {character.name}
                </h3>
                {character.title && (
                  <p className="text-[10px] qt-text-secondary leading-tight mt-0.5">
                    {character.title}
                  </p>
                )}
              </div>
            </Link>
            <button
              onClick={(e) => handleChatClick(e, character)}
              className="mt-auto pt-2 w-full qt-button-success qt-button-sm"
              title={`Start a chat with ${character.name}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Chat
            </button>
          </div>
        ))}
      </div>
      {/* Desktop: flexbox layout for centering */}
      <div className="hidden sm:flex sm:flex-wrap sm:justify-center gap-4">
        {visibleCharacters.map((character) => (
          <div
            key={character.id}
            className="flex flex-col items-center h-full w-40 p-4 rounded-lg border border-border bg-card hover:border-primary hover:shadow-md transition-all"
          >
            <Link
              href={`/characters/${character.id}/view`}
              className="flex flex-col items-center gap-2 w-full hover:opacity-80 transition-opacity"
            >
              <Avatar
                name={character.name}
                src={character}
                size="lg"
              />
              <h3 className="text-sm font-semibold text-foreground text-center w-full px-1 leading-tight">
                {character.name}
              </h3>
              {character.title && (
                <p className="qt-text-xs text-center w-full px-1 pb-4 qt-text-secondary leading-tight">
                  {character.title}
                </p>
              )}
            </Link>
            <button
              onClick={(e) => handleChatClick(e, character)}
              className="mt-auto pt-2 qt-button-success"
              title={`Start a chat with ${character.name}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Chat
            </button>
          </div>
        ))}
      </div>

      {/* Quick Chat Dialog */}
      {chatDialogCharacter && (
        <QuickChatDialog
          characterId={chatDialogCharacter.id}
          characterName={chatDialogCharacter.name}
          isOpen={true}
          onClose={() => setChatDialogCharacter(null)}
        />
      )}
    </div>
  )
}
