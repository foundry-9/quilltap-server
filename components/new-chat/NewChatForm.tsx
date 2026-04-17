'use client'

import { useCallback, useMemo } from 'react'
import Link from 'next/link'
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { TimestampConfigCard } from '@/components/settings/chat-settings/components/TimestampConfigCard'
import { OutfitSelector } from '@/components/wardrobe'
import type { OutfitSelection } from '@/components/wardrobe'
import { useUserCharacterDisplayName } from '@/hooks/usePersonaDisplayName'
import type { TimestampConfig } from '@/lib/schemas/types'
import type {
  ConnectionProfile,
  ImageProfile,
  NewChatFormState,
  Project,
  SelectedCharacter,
  UserControlledCharacter,
} from './types'
import { CUSTOM_SCENARIO_VALUE } from './types'

interface NewChatFormProps {
  profiles: ConnectionProfile[]
  imageProfiles: ImageProfile[]
  userControlledCharacters: UserControlledCharacter[]
  selectedCharacters: SelectedCharacter[]
  setSelectedCharacters: React.Dispatch<React.SetStateAction<SelectedCharacter[]>>
  state: NewChatFormState
  setState: React.Dispatch<React.SetStateAction<NewChatFormState>>
  project: Project | null
  creating: boolean
  /**
   * When true, renders connection-profile and system-prompt selects inline for a
   * single LLM-controlled character (used by the modal when the picker is collapsed).
   * When false, the caller is expected to render those controls in a picker panel.
   */
  showSingleCharacterControls?: boolean
}

export function NewChatForm({
  profiles,
  imageProfiles,
  userControlledCharacters,
  selectedCharacters,
  setSelectedCharacters,
  state,
  setState,
  project,
  creating,
  showSingleCharacterControls = false,
}: NewChatFormProps) {
  const { formatCharacterName } = useUserCharacterDisplayName()

  const llmSelected = useMemo(
    () => selectedCharacters.filter((sc) => sc.controlledBy === 'llm'),
    [selectedCharacters]
  )
  const singleLlm = llmSelected.length === 1 ? llmSelected[0] : null

  const singleCharacterScenarios = useMemo(() => {
    if (!singleLlm) return null
    const s = singleLlm.character.scenarios
    return s && s.length > 0 ? s : null
  }, [singleLlm])

  const selectedPreset = state.scenarioId
    ? singleCharacterScenarios?.find((s) => s.id === state.scenarioId)
    : null
  const showCustomTextarea = !singleCharacterScenarios || state.scenarioId === null

  const handleScenarioSelectChange = (value: string) => {
    if (value === CUSTOM_SCENARIO_VALUE || value === '') {
      setState((prev) => ({ ...prev, scenarioId: null }))
    } else {
      setState((prev) => ({ ...prev, scenarioId: value, scenario: '' }))
    }
  }

  const handleSingleProfileChange = (profileId: string) => {
    if (!singleLlm) return
    setSelectedCharacters((prev) =>
      prev.map((sc) =>
        sc.character.id === singleLlm.character.id ? { ...sc, connectionProfileId: profileId } : sc
      )
    )
  }

  const handleSingleSystemPromptChange = (promptId: string | null) => {
    if (!singleLlm) return
    setSelectedCharacters((prev) =>
      prev.map((sc) =>
        sc.character.id === singleLlm.character.id ? { ...sc, selectedSystemPromptId: promptId } : sc
      )
    )
  }

  const singleCharacterId = singleLlm?.character.id
  const characterIdForImage = singleCharacterId || selectedCharacters[0]?.character.id || undefined

  const outfitCharacters = useMemo(() => {
    const list = llmSelected.map((sc) => ({ id: sc.character.id, name: sc.character.name }))
    const userChar = userControlledCharacters.find((c) => c.id === state.selectedUserCharacterId)
    if (userChar) list.push({ id: userChar.id, name: userChar.name })
    return list
  }, [llmSelected, userControlledCharacters, state.selectedUserCharacterId])

  const handleOutfitSelectionsChange = useCallback(
    (selections: OutfitSelection[]) => {
      setState((prev) => ({ ...prev, outfitSelections: selections }))
    },
    [setState]
  )

  const handleImageProfileChange = useCallback(
    (id: string | null) => {
      setState((prev) => ({ ...prev, imageProfileId: id || '' }))
    },
    [setState]
  )

  const handleTimestampConfigChange = useCallback(
    (config: TimestampConfig) => {
      setState((prev) => ({ ...prev, timestampConfig: config }))
    },
    [setState]
  )

  const showSystemPromptDropdown =
    showSingleCharacterControls &&
    singleLlm &&
    singleLlm.character.systemPrompts &&
    singleLlm.character.systemPrompts.length > 1

  return (
    <div className="new-chat-form grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
      {/* Left card: Character Customization */}
      <div className="rounded-xl border qt-border-default qt-bg-card p-6 space-y-4">
        <h3 className="text-lg font-semibold">Character Customization</h3>

        {profiles.length === 0 && (
          <div className="rounded-lg border qt-border-warning/50 qt-bg-warning/10 p-3 qt-text-warning">
            <p className="text-sm font-medium">No connection profiles available</p>
            <p className="mt-1 text-xs">
              <Link href="/settings?tab=providers" className="underline hover:no-underline">
                Add an AI provider
              </Link>{' '}
              to start a chat.
            </p>
          </div>
        )}

        {showSingleCharacterControls && singleLlm && (
          <div>
            <label htmlFor="new-chat-profile" className="mb-2 block text-sm qt-text-primary">
              Connection Profile *
            </label>
            <select
              id="new-chat-profile"
              value={singleLlm.connectionProfileId}
              onChange={(e) => handleSingleProfileChange(e.target.value)}
              disabled={creating}
              className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select a profile</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                  {profile.modelName ? ` (${profile.modelName})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {showSystemPromptDropdown && singleLlm && (
          <div>
            <label htmlFor="new-chat-system-prompt" className="mb-2 block text-sm qt-text-primary">
              System Prompt
            </label>
            <select
              id="new-chat-system-prompt"
              value={singleLlm.selectedSystemPromptId || ''}
              onChange={(e) => handleSingleSystemPromptChange(e.target.value || null)}
              disabled={creating}
              className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Use Default</option>
              {singleLlm.character.systemPrompts!.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.name}
                  {prompt.isDefault ? ' (Default)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {userControlledCharacters.length > 0 && (
          <div>
            <label htmlFor="new-chat-partner" className="mb-2 block text-sm qt-text-primary">
              Play As (Optional)
            </label>
            <select
              id="new-chat-partner"
              value={state.selectedUserCharacterId}
              onChange={(e) =>
                setState((prev) => ({ ...prev, selectedUserCharacterId: e.target.value }))
              }
              disabled={creating}
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

        <div>
          <label className="mb-2 block text-sm qt-text-primary">
            Image Generation Profile (Optional)
          </label>
          {imageProfiles.length > 0 ? (
            <ImageProfilePicker
              value={state.imageProfileId || null}
              onChange={handleImageProfileChange}
              characterId={characterIdForImage}
              userCharacterId={state.selectedUserCharacterId}
            />
          ) : (
            <p className="qt-text-xs qt-text-muted">
              No image profiles configured.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="new-chat-scenario" className="mb-2 block text-sm qt-text-primary">
            Starting Scenario (Optional)
          </label>
          {singleCharacterScenarios && (
            <select
              id="new-chat-scenario-select"
              value={state.scenarioId ?? CUSTOM_SCENARIO_VALUE}
              onChange={(e) => handleScenarioSelectChange(e.target.value)}
              disabled={creating}
              className="mb-2 w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value={CUSTOM_SCENARIO_VALUE}>Custom...</option>
              {singleCharacterScenarios.map((s) => (
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
              id="new-chat-scenario"
              value={state.scenario}
              onChange={(e) => setState((prev) => ({ ...prev, scenario: e.target.value }))}
              placeholder="Describe the starting scenario for this chat..."
              disabled={creating}
              rows={3}
              className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
        </div>

        {outfitCharacters.length > 0 && (
          <OutfitSelector
            characters={outfitCharacters}
            onSelectionsChange={handleOutfitSelectionsChange}
            disabled={creating}
          />
        )}

        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={state.avatarGenerationEnabled}
              onChange={(e) =>
                setState((prev) => ({ ...prev, avatarGenerationEnabled: e.target.checked }))
              }
              className="qt-checkbox"
              disabled={creating}
            />
            <span className="qt-text-small">Auto-generate character avatars</span>
          </label>
          <p className="qt-text-xs qt-text-muted mt-1">
            Generate new portraits when outfits change (uses image API)
          </p>
        </div>
      </div>

      {/* Right card: Reality Injection Mode */}
      <div className="rounded-xl border qt-border-default qt-bg-card p-6 space-y-4">
        <h3 className="text-lg font-semibold">Reality Injection Mode</h3>
        <TimestampConfigCard
          value={state.timestampConfig}
          onChange={handleTimestampConfigChange}
          compact
          disabled={creating}
        />
      </div>

      {project && (
        <div className="md:col-span-2 rounded-lg border qt-border-default qt-bg-card/50 p-3">
          <div className="flex items-center gap-3">
            <div
              className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: project.color || 'var(--muted)' }}
            >
              <svg className="w-3 h-3 qt-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="qt-text-xs qt-text-muted">In project</p>
              <p className="text-sm truncate">{project.name}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
