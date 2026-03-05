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
import { ProviderModelBadge } from '@/components/ui/ProviderModelBadge'
import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'
import type { HomepageCharacter } from './types'

interface CharacterCardProps {
  character: HomepageCharacter
}

export function CharacterCard({ character }: CharacterCardProps) {
  const [showDialog, setShowDialog] = useState(false)
  const { getProfileProvider } = useConnectionProfiles()
  const profileInfo = character.defaultConnectionProfileId
    ? getProfileProvider(character.defaultConnectionProfileId)
    : null

  return (
    <>
      <div className="flex flex-col items-center p-3 h-full rounded-lg border border-border bg-card hover:border-primary hover:qt-shadow-md transition-all">
        <Link
          href={`/aurora/${character.id}/view`}
          className="flex flex-col items-center gap-2 flex-grow hover:opacity-80 transition-opacity"
        >
          <Avatar
            name={character.name}
            src={character}
            size="md"
          />
          <div className="text-center min-w-0 w-full">
            <p className="qt-card-title truncate">
              {character.name}
            </p>
            <p className="qt-card-subtitle line-clamp-2 italic min-h-[2.5rem]">
              {character.title || '\u00A0'}
            </p>
            {profileInfo && (
              <ProviderModelBadge provider={profileInfo.provider} modelName={profileInfo.modelName} size="sm" />
            )}
          </div>
        </Link>
        <button
          onClick={() => setShowDialog(true)}
          className="mt-auto pt-2 w-full qt-button-success qt-button-sm"
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
