'use client'

import Link from 'next/link'
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { Character, ConnectionProfile, UserControlledCharacter } from '../types'
import { USER_CONTROLLED_PROFILE_ID } from '@/lib/constants/character'

interface ProfilesTabProps {
  characterId: string
  character: Character | null
  profiles: ConnectionProfile[]
  userControlledCharacters: UserControlledCharacter[]
  defaultPartnerId: string
  defaultImageProfileId: string
  savingConnectionProfile: boolean
  savingPartner: boolean
  savingImageProfile?: boolean
  savingAgentMode?: boolean
  onConnectionProfileChange: (profileId: string) => void
  onPartnerChange: (partnerId: string) => void
  onImageProfileChange: (profileId: string | null) => void
  onAgentModeChange: (enabled: boolean | null) => void
}

export function ProfilesTab({
  characterId,
  character,
  profiles,
  userControlledCharacters,
  defaultPartnerId,
  defaultImageProfileId,
  savingConnectionProfile,
  savingPartner,
  savingImageProfile,
  savingAgentMode,
  onConnectionProfileChange,
  onPartnerChange,
  onImageProfileChange,
  onAgentModeChange,
}: ProfilesTabProps) {
  // Check if this character is user-controlled (disable partner selection if so)
  const isUserControlled = character?.controlledBy === 'user'

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
            value={
              character?.controlledBy === 'user'
                ? USER_CONTROLLED_PROFILE_ID
                : character?.defaultConnectionProfileId || ''
            }
            onChange={(e) => onConnectionProfileChange(e.target.value)}
            disabled={savingConnectionProfile}
            className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <option value="">No default profile</option>
            <option value={USER_CONTROLLED_PROFILE_ID}>User Acts As Character</option>
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

      {/* Default Partner Section */}
      <div className={`character-section-card rounded-lg border border-border bg-card p-6 ${isUserControlled ? 'opacity-50' : ''}`}>
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Default Conversation Partner
        </h2>
        <p className="qt-text-small mb-4">
          {isUserControlled
            ? 'Not applicable when this character is user-controlled.'
            : 'The default user-controlled character to represent you when chatting with this character.'}
        </p>
        <div className="flex items-center gap-3">
          <select
            value={defaultPartnerId}
            onChange={(e) => onPartnerChange(e.target.value)}
            disabled={savingPartner || isUserControlled}
            className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <option value="">No default partner</option>
            {userControlledCharacters
              .filter(c => c.id !== characterId) // Exclude current character
              .map((char) => (
                <option key={char.id} value={char.id}>
                  {char.name}{char.title ? ` - ${char.title}` : ''}
                </option>
              ))}
          </select>
          {savingPartner && (
            <div className="flex items-center gap-2 qt-text-small">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-r-transparent"></div>
              Saving...
            </div>
          )}
        </div>
        {!isUserControlled && userControlledCharacters.filter(c => c.id !== characterId).length === 0 && (
          <p className="mt-2 text-sm text-warning">
            No user-controlled characters available. <Link href="/characters/new" className="underline hover:no-underline">Create one</Link> or set an existing character to &quot;User Acts As Character&quot;.
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
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <ImageProfilePicker
              value={defaultImageProfileId || null}
              onChange={(profileId) => onImageProfileChange(profileId || null)}
              characterId={characterId}
              disabled={savingImageProfile}
            />
          </div>
          {savingImageProfile && (
            <div className="flex items-center gap-2 qt-text-small">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-r-transparent"></div>
              Saving...
            </div>
          )}
        </div>
      </div>

      {/* Agent Mode Section */}
      <div className="character-section-card rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Agent Mode
        </h2>
        <p className="qt-text-small mb-4">
          Control whether agent mode is enabled by default for chats with this character.
          Agent mode allows the AI to iteratively use tools, verify results, and self-correct before delivering a final response.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={character?.defaultAgentModeEnabled === null || character?.defaultAgentModeEnabled === undefined ? 'inherit' : character.defaultAgentModeEnabled ? 'enabled' : 'disabled'}
            onChange={(e) => {
              const value = e.target.value
              onAgentModeChange(value === 'inherit' ? null : value === 'enabled')
            }}
            disabled={savingAgentMode}
            className="flex-1 max-w-xs rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <option value="inherit">Inherit from global settings</option>
            <option value="enabled">Enabled by default</option>
            <option value="disabled">Disabled by default</option>
          </select>
          {savingAgentMode && (
            <div className="flex items-center gap-2 qt-text-small">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-r-transparent"></div>
              Saving...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
