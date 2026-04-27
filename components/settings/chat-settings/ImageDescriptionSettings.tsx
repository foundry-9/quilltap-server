'use client'

import { SettingsCard } from '@/components/ui/SettingsCard'
import { ChatSettings, ConnectionProfile } from './types'

export interface ImageDescriptionSettingsProps {
  settings: ChatSettings
  saving: boolean
  loadingProfiles: boolean
  connectionProfiles: ConnectionProfile[]
  onProfileChange: (profileId: string | null) => Promise<void>
}

/**
 * ImageDescriptionSettings Component
 * Manages image description profile selection for vision-capable LLMs
 */
export function ImageDescriptionSettings({
  settings,
  saving,
  loadingProfiles,
  connectionProfiles,
  onProfileChange,
}: ImageDescriptionSettingsProps) {
  const visionProfiles = connectionProfiles.filter(profile => profile.supportsImageUpload === true)

  return (
    <SettingsCard
      title="Image Description Profile"
      subtitle="When you attach an image to a chat with a provider that doesn't support images (like Ollama, OpenRouter, etc.), this profile will be used to generate a text description of the image."
    >
      <div className="space-y-4">
        <div>
          <label className="block qt-text-label mb-2">
            Image Description Profile
          </label>
          <p className="qt-text-xs mb-2">
            Select a vision-capable profile (like gpt-4o-mini, claude-haiku-4-5, or gemini-2.0-flash) to describe images.
            If not set, the system will automatically use any available vision-capable profile.
          </p>
          <select
            value={settings?.imageDescriptionProfileId || ''}
            onChange={(e) => onProfileChange(e.target.value || null)}
            disabled={saving || loadingProfiles}
            className="qt-select"
          >
            <option value="">Auto-select vision-capable profile</option>
            {visionProfiles.map((profile) => {
              const hasApiKey = Boolean(profile.apiKey)
              return (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.provider} • {profile.modelName}){!hasApiKey ? ' ⚠️ No API Key' : ''}
                </option>
              )
            })}
          </select>
          {visionProfiles.length === 0 && (
            <p className="mt-1 text-xs qt-text-warning">
              No vision-capable profiles found. Edit a connection profile and enable &ldquo;Supports image attachments&rdquo;, or create a new one.
            </p>
          )}
        </div>
      </div>
    </SettingsCard>
  )
}
