'use client'

/**
 * CharacterCard
 *
 * Individual character card for the homepage 2x2 grid.
 * Clicking opens a quick chat dialog.
 */

import { useState } from 'react'
import Link from 'next/link'
import Avatar from '@/components/ui/Avatar'
import { QuickChatDialog } from '@/components/dashboard/QuickChatDialog'
import type { HomepageCharacter } from './types'

interface CharacterCardProps {
  character: HomepageCharacter
}

export function CharacterCard({ character }: CharacterCardProps) {
  const [showDialog, setShowDialog] = useState(false)

  return (
    <>
      <div className="flex flex-col items-center p-3 rounded-lg border border-border bg-card hover:border-primary hover:shadow-md transition-all">
        <Link
          href={`/characters/${character.id}/view`}
          className="flex flex-col items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <Avatar
            name={character.name}
            src={character}
            size="md"
          />
          <div className="text-center min-w-0 w-full">
            <p className="text-sm font-medium text-foreground truncate">
              {character.name}
            </p>
            {character.title && (
              <p className="text-xs text-muted-foreground truncate">
                {character.title}
              </p>
            )}
          </div>
        </Link>
        <button
          onClick={() => setShowDialog(true)}
          className="mt-2 w-full qt-button-success qt-button-sm"
          title={`Start a chat with ${character.name}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          Chat
        </button>
      </div>

      {showDialog && (
        <QuickChatDialog
          characterId={character.id}
          characterName={character.name}
          isOpen={true}
          onClose={() => setShowDialog(false)}
        />
      )}
    </>
  )
}
