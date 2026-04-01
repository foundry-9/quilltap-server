'use client'

import { ChatSettings, ConnectionProfile, VISION_PROVIDERS } from './types'

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
  const visionProfiles = connectionProfiles.filter(profile =>
    VISION_PROVIDERS.includes(profile.provider as typeof VISION_PROVIDERS[number])
  )

  return (
    <div className="border-t border-border pt-6">
      <h2 className="text-xl font-semibold mb-4">Image Description Profile</h2>
      <p className="text-muted-foreground mb-4">
        When you attach an image to a chat with a provider that doesn&apos;t support images (like Ollama, OpenRouter, etc.),
        this profile will be used to generate a text description of the image.
      </p>

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
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              No vision-capable profiles found. Create an OpenAI, Anthropic, Google, or Grok profile in the Connection Profiles tab.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
