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
import { NewChatModal } from '@/components/new-chat'
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

  // For compact card display, strip provider prefix (e.g., "GROK/grok-4.20..." → "grok-4.20...")
  const profileDisplayName = (() => {
    const name = profileInfo?.name || profileInfo?.modelName || ''
    if (!name) return ''
    const provider = profileInfo?.provider || ''
    const prefixes = [`${provider}/`, `${provider.toLowerCase()}/`]
    for (const prefix of prefixes) {
      if (name.startsWith(prefix)) return name.slice(prefix.length)
    }
    return name
  })()

  return (
    <>
      <div className="qt-character-card">
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
              <ProviderModelBadge
                provider={profileInfo.provider}
                modelName={profileDisplayName}
                title={`${profileInfo.name || profileInfo.provider}: ${profileInfo.modelName}`}
                size="sm"
                compact
              />
            )}
          </div>
        </Link>
        <button
          onClick={() => setShowDialog(true)}
          className="mt-auto w-full qt-button-success qt-button-sm"
          title={`Start a chat with ${character.name}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          Chat
        </button>
      </div>

      {showDialog && (
        <NewChatModal
          characterId={character.id}
          characterName={character.name}
          isOpen={true}
          onClose={() => setShowDialog(false)}
        />
      )}
    </>
  )
}
