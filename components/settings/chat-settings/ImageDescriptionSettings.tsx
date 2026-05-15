'use client'

import { SettingsCard } from '@/components/ui/SettingsCard'
import { ChatSettings, ConnectionProfile } from './types'

export interface ImageDescriptionSettingsProps {
  settings: ChatSettings
  saving: boolean
  loadingProfiles: boolean
  connectionProfiles: ConnectionProfile[]
  onProfileChange: (profileId: string | null) => Promise<void>
  onUncensoredProfileChange: (profileId: string | null) => Promise<void>
}

/**
 * ImageDescriptionSettings Component
 * Manages image description profile selection for vision-capable LLMs.
 *
 * Two profiles can be configured:
 *  - **Primary**: used for every attached image first.
 *  - **Uncensored fallback**: used when the primary refuses or returns an
 *    unusable response. Optional; usually a more permissive vision model.
 */
export function ImageDescriptionSettings({
  settings,
  saving,
  loadingProfiles,
  connectionProfiles,
  onProfileChange,
  onUncensoredProfileChange,
}: ImageDescriptionSettingsProps) {
  const visionProfiles = connectionProfiles.filter(profile => profile.supportsImageUpload === true)

  return (
    <SettingsCard
      title="Image Description Profiles"
      subtitle="When you attach an image to a chat with a provider that doesn't support images (like Ollama, OpenRouter, etc.), the primary profile describes it in text. If the primary refuses or returns an unusable response, the uncensored fallback profile tries instead."
    >
      <div className="space-y-4">
        <div>
          <label className="block qt-text-label mb-2">
            Primary image description profile
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

        <div>
          <label className="block qt-text-label mb-2">
            Uncensored fallback profile
          </label>
          <p className="qt-text-xs mb-2">
            Optional. Used only when the primary profile refuses to describe an image. A more permissive vision model
            (a local Ollama llava variant, an uncensored router model, etc.) is the usual choice. Leave blank to skip the fallback.
          </p>
          <select
            value={settings?.uncensoredImageDescriptionProfileId || ''}
            onChange={(e) => onUncensoredProfileChange(e.target.value || null)}
            disabled={saving || loadingProfiles}
            className="qt-select"
          >
            <option value="">No fallback (recommended for benign content)</option>
            {visionProfiles.map((profile) => {
              const hasApiKey = Boolean(profile.apiKey)
              return (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.provider} • {profile.modelName}){!hasApiKey ? ' ⚠️ No API Key' : ''}
                </option>
              )
            })}
          </select>
        </div>
      </div>
    </SettingsCard>
  )
}
