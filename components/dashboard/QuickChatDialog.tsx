'use client'

import { useEffect } from 'react'
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { TimestampConfigCard } from '@/components/settings/chat-settings/components/TimestampConfigCard'
import { OutfitSelector } from '@/components/wardrobe'
import { useQuickChat } from './hooks'

const CUSTOM_SCENARIO_VALUE = '__custom__'

interface QuickChatDialogProps {
  characterId: string
  characterName: string
  isOpen: boolean
  onClose: () => void
}

export function QuickChatDialog({
  characterId,
  characterName,
  isOpen,
  onClose,
}: QuickChatDialogProps) {
  const {
    loading,
    profiles,
    userControlledCharacters,
    selectedProfileId,
    selectedPartnerId,
    selectedImageProfileId,
    scenario,
    scenarioId,
    scenarios,
    timestampConfig,
    outfitSelections,
    creatingChat,
    setSelectedProfileId,
    setSelectedPartnerId,
    setSelectedImageProfileId,
    setScenario,
    setScenarioId,
    setTimestampConfig,
    setOutfitSelections,
    fetchData,
    handleCreateChat,
    reset,
  } = useQuickChat()

  const hasScenarios = scenarios.length > 0
  const selectedPreset = scenarioId ? scenarios.find((s) => s.id === scenarioId) : null
  const showCustomTextarea = !hasScenarios || scenarioId === null

  const handleScenarioSelectChange = (value: string) => {
    if (value === CUSTOM_SCENARIO_VALUE || value === '') {
      setScenarioId(null)
    } else {
      setScenarioId(value)
      setScenario('')
    }
  }

  useEffect(() => {
    if (isOpen) {
      fetchData(characterId)
    }
  }, [isOpen, characterId, characterName, fetchData])

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleCreate = async () => {
    await handleCreateChat(characterId, characterName)
    handleClose()
  }

  if (!isOpen) return null

  return (
    <div className="quick-chat-dialog fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md md:max-w-3xl rounded-2xl border qt-border-default qt-bg-card p-6 qt-shadow-lg max-h-[90vh] flex flex-col">
        <h3 className="mb-4 text-lg font-semibold flex-shrink-0">
          Start Chat with {characterName}
        </h3>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <p className="qt-text-secondary">Loading...</p>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 pr-2 -mr-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Basic Options */}
              <div className="space-y-4">
                {/* Connection Profile Selection */}
                <div>
                  <label htmlFor="quick-profile" className="mb-2 block text-sm qt-text-primary">
                    Connection Profile *
                  </label>
                  <select
                    id="quick-profile"
                    value={selectedProfileId}
                    onChange={(e) => setSelectedProfileId(e.target.value)}
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

                {/* User-Controlled Character Selection (Play As) */}
                {userControlledCharacters.length > 0 && (
                  <div>
                    <label htmlFor="quick-partner" className="mb-2 block text-sm qt-text-primary">
                      Play As (Optional)
                    </label>
                    <select
                      id="quick-partner"
                      value={selectedPartnerId}
                      onChange={(e) => setSelectedPartnerId(e.target.value)}
                      className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Chat as yourself</option>
                      {userControlledCharacters.map((char) => (
                        <option key={char.id} value={char.id}>
                          {char.name}{char.title ? ` - ${char.title}` : ''}
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
                    onChange={setSelectedImageProfileId}
                    characterId={characterId}
                    personaId={selectedPartnerId}
                  />
                </div>

                {/* Scenario Description */}
                <div>
                  <label htmlFor="quick-scenario" className="mb-2 block text-sm qt-text-primary">
                    Starting Scenario (Optional)
                  </label>

                  {hasScenarios && (
                    <select
                      id="quick-scenario-select"
                      value={scenarioId ?? CUSTOM_SCENARIO_VALUE}
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
                      id="quick-scenario"
                      value={scenario}
                      onChange={(e) => setScenario(e.target.value)}
                      placeholder="Describe the starting scenario for this chat..."
                      className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      rows={3}
                    />
                  )}
                </div>
              </div>

              {/* Right Column: Outfit & Timestamp Configuration */}
              <div className="space-y-4">
                <OutfitSelector
                  characters={[{ id: characterId, name: characterName }]}
                  onSelectionsChange={setOutfitSelections}
                  disabled={creatingChat}
                />
                <TimestampConfigCard
                  config={timestampConfig}
                  onChange={setTimestampConfig}
                  compact={true}
                  disabled={creatingChat}
                />
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3 flex-shrink-0">
          <button
            onClick={handleClose}
            className="inline-flex items-center rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm font-medium qt-text-secondary qt-shadow-sm transition hover:qt-bg-muted cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!selectedProfileId || creatingChat || loading}
            className="inline-flex items-center rounded-lg bg-success px-4 py-2 text-sm font-semibold qt-text-success-foreground shadow transition hover:qt-bg-success/90 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
          >
            {creatingChat ? 'Creating...' : 'Start Chat'}
          </button>
        </div>
      </div>
    </div>
  )
}
