'use client'

import { useState } from 'react'
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { TimestampConfigCard } from '@/components/settings/chat-settings/components/TimestampConfigCard'
import { ConnectionProfile, UserControlledCharacter } from '../types'
import { useUserCharacterDisplayName } from '@/hooks/usePersonaDisplayName'
import type { TimestampConfig } from '@/lib/schemas/types'

const CUSTOM_SCENARIO_VALUE = '__custom__'

interface ChatCreationDialogProps {
  characterId: string
  characterName: string | undefined
  profiles: ConnectionProfile[]
  userControlledCharacters: UserControlledCharacter[]
  selectedProfileId: string
  selectedUserCharacterId: string
  selectedImageProfileId: string | null
  scenario: string
  scenarios?: Array<{ id: string; title: string; content: string }>
  timestampConfig: TimestampConfig | null
  creatingChat: boolean
  openedFromQuery: boolean
  onProfileChange: (profileId: string) => void
  onUserCharacterChange: (userCharacterId: string) => void
  onImageProfileChange: (profileId: string | null) => void
  onScenarioChange: (scenario: string) => void
  onScenarioIdChange?: (scenarioId: string | null) => void
  onTimestampConfigChange: (config: TimestampConfig) => void
  onCancel: () => void
  onCreateChat: () => void
}

export function ChatCreationDialog({
  characterId,
  characterName,
  profiles,
  userControlledCharacters,
  selectedProfileId,
  selectedUserCharacterId,
  selectedImageProfileId,
  scenario,
  scenarios,
  timestampConfig,
  creatingChat,
  openedFromQuery,
  onProfileChange,
  onUserCharacterChange,
  onImageProfileChange,
  onScenarioChange,
  onScenarioIdChange,
  onTimestampConfigChange,
  onCancel,
  onCreateChat,
}: ChatCreationDialogProps) {
  const { formatCharacterName } = useUserCharacterDisplayName()
  const hasScenarios = scenarios && scenarios.length > 0

  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null)

  const handleScenarioSelectChange = (value: string) => {
    if (value === CUSTOM_SCENARIO_VALUE || value === '') {
      setSelectedScenarioId(null)
      onScenarioIdChange?.(null)
    } else {
      setSelectedScenarioId(value)
      onScenarioIdChange?.(value)
      // Clear any custom text when switching to a preset
      onScenarioChange('')
    }
  }

  const selectedPreset = selectedScenarioId
    ? scenarios?.find((s) => s.id === selectedScenarioId)
    : null

  const showCustomTextarea = !hasScenarios || selectedScenarioId === null

  return (
    <div className="character-chat-dialog fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md md:max-w-3xl rounded-2xl border border-border bg-card p-6 shadow-2xl max-h-[90vh] flex flex-col">
        <h3 className="mb-4 text-lg font-semibold flex-shrink-0">
          Start Chat with {characterName}
        </h3>

        <div className="overflow-y-auto flex-1 pr-2 -mr-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Column: Basic Options */}
            <div className="space-y-4">
              {/* Connection Profile Selection */}
              <div>
                <label htmlFor="profile" className="mb-2 block text-sm qt-text-primary">
                  Connection Profile *
                </label>
                <select
                  id="profile"
                  value={selectedProfileId}
                  onChange={(e) => onProfileChange(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select a profile</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* User Character Selection */}
              {userControlledCharacters.length > 0 && (
                <div>
                  <label htmlFor="userCharacter" className="mb-2 block text-sm qt-text-primary">
                    Play As (Optional)
                  </label>
                  <select
                    id="userCharacter"
                    value={selectedUserCharacterId}
                    onChange={(e) => onUserCharacterChange(e.target.value)}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Chat as yourself</option>
                    {userControlledCharacters.map((char) => (
                      <option key={char.id} value={char.id}>
                        {formatCharacterName(char)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Image Profile Selection */}
              <div>
                <label className="mb-2 block text-sm qt-text-primary">
                  Image Generation Profile (Optional)
                </label>
                <ImageProfilePicker
                  value={selectedImageProfileId}
                  onChange={onImageProfileChange}
                  characterId={characterId}
                  personaId={selectedUserCharacterId}
                />
              </div>

              {/* Scenario Description */}
              <div>
                <label htmlFor="scenario" className="mb-2 block text-sm qt-text-primary">
                  Starting Scenario (Optional)
                </label>

                {hasScenarios && (
                  <select
                    id="scenarioSelect"
                    value={selectedScenarioId ?? CUSTOM_SCENARIO_VALUE}
                    onChange={(e) => handleScenarioSelectChange(e.target.value)}
                    className="mb-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value={CUSTOM_SCENARIO_VALUE}>Custom...</option>
                    {scenarios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                )}

                {selectedPreset && (
                  <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    {selectedPreset.content}
                  </div>
                )}

                {showCustomTextarea && (
                  <textarea
                    id="scenario"
                    value={scenario}
                    onChange={(e) => onScenarioChange(e.target.value)}
                    placeholder="Describe the starting scenario for this chat..."
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    rows={3}
                  />
                )}
              </div>
            </div>

            {/* Right Column: Timestamp Configuration */}
            <div>
              <TimestampConfigCard
                config={timestampConfig}
                onChange={onTimestampConfigChange}
                compact={true}
                disabled={creatingChat}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3 flex-shrink-0">
          <button
            onClick={onCancel}
            className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm transition hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={onCreateChat}
            disabled={!selectedProfileId || creatingChat}
            className="inline-flex items-center rounded-lg bg-success px-4 py-2 text-sm font-semibold text-success-foreground shadow transition hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creatingChat ? 'Creating...' : 'Start Chat'}
          </button>
        </div>
      </div>
    </div>
  )
}
