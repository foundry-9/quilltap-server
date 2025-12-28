'use client'

import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { TimestampConfigCard } from '@/components/settings/chat-settings/components/TimestampConfigCard'
import { ConnectionProfile, Persona } from '../types'
import { usePersonaDisplayName } from '@/hooks/usePersonaDisplayName'
import type { TimestampConfig } from '@/lib/schemas/types'

interface ChatCreationDialogProps {
  characterId: string
  characterName: string | undefined
  profiles: ConnectionProfile[]
  personas: Persona[]
  selectedProfileId: string
  selectedPersonaId: string
  selectedImageProfileId: string | null
  scenario: string
  timestampConfig: TimestampConfig | null
  creatingChat: boolean
  openedFromQuery: boolean
  onProfileChange: (profileId: string) => void
  onPersonaChange: (personaId: string) => void
  onImageProfileChange: (profileId: string | null) => void
  onScenarioChange: (scenario: string) => void
  onTimestampConfigChange: (config: TimestampConfig) => void
  onCancel: () => void
  onCreateChat: () => void
}

export function ChatCreationDialog({
  characterId,
  characterName,
  profiles,
  personas,
  selectedProfileId,
  selectedPersonaId,
  selectedImageProfileId,
  scenario,
  timestampConfig,
  creatingChat,
  openedFromQuery,
  onProfileChange,
  onPersonaChange,
  onImageProfileChange,
  onScenarioChange,
  onTimestampConfigChange,
  onCancel,
  onCreateChat,
}: ChatCreationDialogProps) {
  const { formatPersonaName } = usePersonaDisplayName()

  return (
    <div className="character-chat-dialog fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <h3 className="mb-4 text-lg font-semibold">
          Start Chat with {characterName}
        </h3>

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

          {/* Persona Selection */}
          {personas.length > 0 && (
            <div>
              <label htmlFor="persona" className="mb-2 block text-sm qt-text-primary">
                Persona (Optional)
              </label>
              <select
                id="persona"
                value={selectedPersonaId}
                onChange={(e) => onPersonaChange(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Use character defaults</option>
                {personas.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {formatPersonaName(persona)}
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
              personaId={selectedPersonaId}
            />
          </div>

          {/* Scenario Description */}
          <div>
            <label htmlFor="scenario" className="mb-2 block text-sm qt-text-primary">
              Starting Scenario (Optional)
            </label>
            <textarea
              id="scenario"
              value={scenario}
              onChange={(e) => onScenarioChange(e.target.value)}
              placeholder="Describe the starting scenario for this chat..."
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              rows={3}
            />
          </div>

          {/* Timestamp Configuration */}
          <TimestampConfigCard
            config={timestampConfig}
            onChange={onTimestampConfigChange}
            compact={true}
            disabled={creatingChat}
          />
        </div>

        <div className="mt-6 flex justify-end gap-3">
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
