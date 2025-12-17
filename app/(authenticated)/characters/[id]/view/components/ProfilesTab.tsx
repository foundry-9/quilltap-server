'use client'

import Link from 'next/link'
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { Character, ConnectionProfile, Persona } from '../types'
import { usePersonaDisplayName } from '@/hooks/usePersonaDisplayName'

interface ProfilesTabProps {
  characterId: string
  character: Character | null
  profiles: ConnectionProfile[]
  personas: Persona[]
  defaultPersonaId: string
  defaultImageProfileId: string
  savingConnectionProfile: boolean
  savingPersona: boolean
  onConnectionProfileChange: (profileId: string) => void
  onPersonaChange: (personaId: string) => void
  onImageProfileChange: (profileId: string | null | undefined) => void
}

export function ProfilesTab({
  characterId,
  character,
  profiles,
  personas,
  defaultPersonaId,
  defaultImageProfileId,
  savingConnectionProfile,
  savingPersona,
  onConnectionProfileChange,
  onPersonaChange,
  onImageProfileChange,
}: ProfilesTabProps) {
  const { formatPersonaName } = usePersonaDisplayName()

  if (!character) return null

  return (
    <div className="space-y-8">
      {/* Connection Profile Section */}
      <div className="character-section-card rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Default Connection Profile
        </h2>
        <p className="qt-text-small mb-4">
          The default AI provider and model to use when chatting with this character. Can be overridden per chat.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={character?.defaultConnectionProfileId || ''}
            onChange={(e) => onConnectionProfileChange(e.target.value)}
            disabled={savingConnectionProfile}
            className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <option value="">No default profile</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          {savingConnectionProfile && (
            <div className="flex items-center gap-2 qt-text-small">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-r-transparent"></div>
              Saving...
            </div>
          )}
        </div>
        {profiles.length === 0 && (
          <p className="mt-2 text-sm text-warning">
            No connection profiles available. <Link href="/settings" className="underline hover:no-underline">Create one in Settings</Link>.
          </p>
        )}
      </div>

      {/* Persona Section */}
      <div className="character-section-card rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Default Persona
        </h2>
        <p className="qt-text-small mb-4">
          The default persona to use when chatting with this character. Represents &quot;you&quot; in the conversation.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={defaultPersonaId}
            onChange={(e) => onPersonaChange(e.target.value)}
            disabled={savingPersona}
            className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <option value="">No default persona</option>
            {personas.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {formatPersonaName(persona)}
              </option>
            ))}
          </select>
          {savingPersona && (
            <div className="flex items-center gap-2 qt-text-small">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-r-transparent"></div>
              Saving...
            </div>
          )}
        </div>
        {personas.length === 0 && (
          <p className="mt-2 text-sm text-warning">
            No personas available. <Link href="/personas/new" className="underline hover:no-underline">Create one</Link>.
          </p>
        )}
      </div>

      {/* Image Profile Section */}
      <div className="character-section-card rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Image Generation Profile
        </h2>
        <p className="qt-text-small mb-4">
          The default image generation profile for creating images during chats. Optional.
        </p>
        <ImageProfilePicker
          value={defaultImageProfileId || null}
          onChange={(profileId) => onImageProfileChange(profileId || null)}
          characterId={characterId}
        />
      </div>
    </div>
  )
}
