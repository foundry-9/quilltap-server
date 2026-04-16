'use client'

import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { TimestampConfigCard } from '@/components/settings/chat-settings/components/TimestampConfigCard'
import { OutfitSelector } from '@/components/wardrobe'
import type { OutfitSelection } from '@/components/wardrobe'
import { ConnectionProfile, UserControlledCharacter } from '../types'
import { useUserCharacterDisplayName } from '@/hooks/usePersonaDisplayName'
import type { TimestampConfig } from '@/lib/schemas/types'

const CUSTOM_SCENARIO_VALUE = '__custom__'

interface SystemPrompt {
  id: string
  name: string
  content: string
  isDefault: boolean
}

interface ChatCreationDialogProps {
  characterId: string
  characterName: string | undefined
  profiles: ConnectionProfile[]
  userControlledCharacters: UserControlledCharacter[]
  systemPrompts?: SystemPrompt[]
  selectedProfileId: string
  selectedUserCharacterId: string
  selectedImageProfileId: string | null
  selectedSystemPromptId: string | null
  scenario: string
  scenarioId?: string | null
  scenarios?: Array<{ id: string; title: string; content: string }>
  timestampConfig: TimestampConfig | null
  creatingChat: boolean
  openedFromQuery: boolean
  onProfileChange: (profileId: string) => void
  onUserCharacterChange: (userCharacterId: string) => void
  onImageProfileChange: (profileId: string | null) => void
  onSystemPromptChange: (promptId: string | null) => void
  onScenarioChange: (scenario: string) => void
  onScenarioIdChange?: (scenarioId: string | null) => void
  onTimestampConfigChange: (config: TimestampConfig) => void
  avatarGenerationEnabled?: boolean
  onAvatarGenerationChange?: (enabled: boolean) => void
  outfitSelections?: OutfitSelection[]
  onOutfitSelectionsChange?: (selections: OutfitSelection[]) => void
  onCancel: () => void
  onCreateChat: () => void
}

export function ChatCreationDialog({
  characterId,
  characterName,
  profiles,
  userControlledCharacters,
  systemPrompts,
  selectedProfileId,
  selectedUserCharacterId,
  selectedImageProfileId,
  selectedSystemPromptId,
  scenario,
  scenarioId: initialScenarioId,
  scenarios,
  timestampConfig,
  creatingChat,
  openedFromQuery,
  onProfileChange,
  onUserCharacterChange,
  onImageProfileChange,
  onSystemPromptChange,
  onScenarioChange,
  onScenarioIdChange,
  onTimestampConfigChange,
  avatarGenerationEnabled,
  onAvatarGenerationChange,
  outfitSelections: _outfitSelections,
  onOutfitSelectionsChange,
  onCancel,
  onCreateChat,
}: ChatCreationDialogProps) {
  const { formatCharacterName } = useUserCharacterDisplayName()
  const hasScenarios = scenarios && scenarios.length > 0

  // Scenario selection is controlled by the parent via initialScenarioId/onScenarioIdChange
  const selectedScenarioId = initialScenarioId ?? null

  const handleScenarioSelectChange = (value: string) => {
    if (value === CUSTOM_SCENARIO_VALUE || value === '') {
      onScenarioIdChange?.(null)
    } else {
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
      <div className="w-full max-w-md md:max-w-3xl rounded-2xl border qt-border-default qt-bg-card p-6 shadow-2xl max-h-[90vh] flex flex-col">
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
                  className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select a profile</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* System Prompt Selection */}
              {systemPrompts && systemPrompts.length > 1 && (
                <div>
                  <label htmlFor="systemPrompt" className="mb-2 block text-sm qt-text-primary">
                    System Prompt
                  </label>
                  <select
                    id="systemPrompt"
                    value={selectedSystemPromptId || ''}
                    onChange={(e) => onSystemPromptChange(e.target.value || null)}
                    className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Use Default</option>
                    {systemPrompts.map((prompt) => (
                      <option key={prompt.id} value={prompt.id}>
                        {prompt.name}{prompt.isDefault ? ' (Default)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

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
                    className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
                  userCharacterId={selectedUserCharacterId}
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
                    className="mb-2 w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
                  <div className="rounded-lg border qt-border-default qt-bg-muted/40 px-3 py-2 text-sm qt-text-secondary">
                    {selectedPreset.content}
                  </div>
                )}

                {showCustomTextarea && (
                  <textarea
                    id="scenario"
                    value={scenario}
                    onChange={(e) => onScenarioChange(e.target.value)}
                    placeholder="Describe the starting scenario for this chat..."
                    className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    rows={3}
                  />
                )}
              </div>
            </div>

            {/* Right Column: Outfit & Timestamp Configuration */}
            <div className="space-y-4">
              {onOutfitSelectionsChange && (
                <OutfitSelector
                  characters={(() => {
                    const list = [{ id: characterId, name: characterName || 'Character' }]
                    const userChar = userControlledCharacters.find(c => c.id === selectedUserCharacterId)
                    if (userChar) list.push({ id: userChar.id, name: userChar.name })
                    return list
                  })()}
                  onSelectionsChange={onOutfitSelectionsChange}
                  disabled={creatingChat}
                />
              )}
              {onAvatarGenerationChange && (
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={avatarGenerationEnabled ?? false}
                      onChange={(e) => onAvatarGenerationChange(e.target.checked)}
                      className="qt-checkbox"
                      disabled={creatingChat}
                    />
                    <span className="qt-text-small">Auto-generate character avatars</span>
                  </label>
                  <p className="qt-text-xs qt-text-muted mt-1">
                    Generate new portraits when outfits change (uses image API)
                  </p>
                </div>
              )}
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
            className="inline-flex items-center rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm font-medium qt-text-secondary qt-shadow-sm transition hover:qt-bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={onCreateChat}
            disabled={!selectedProfileId || creatingChat}
            className="inline-flex items-center rounded-lg bg-success px-4 py-2 text-sm font-semibold qt-text-success-foreground shadow transition hover:qt-bg-success/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creatingChat ? 'Creating...' : 'Start Chat'}
          </button>
        </div>
      </div>
    </div>
  )
}
