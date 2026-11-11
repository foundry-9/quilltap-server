'use client'

import { useId } from 'react'
import { SettingsCard } from '@/components/ui/SettingsCard'
import type { ChatSettings, ImageProfile } from './types'

export interface StoryBackgroundsSettingsProps {
  settings: ChatSettings
  saving: boolean
  loadingProfiles: boolean
  imageProfiles: ImageProfile[]
  onEnabledChange: (value: boolean) => Promise<void>
  onProfileChange: (profileId: string | null) => Promise<void>
}

export function StoryBackgroundsSettings({
  settings,
  saving,
  loadingProfiles,
  imageProfiles,
  onEnabledChange,
  onProfileChange,
}: StoryBackgroundsSettingsProps) {
  const id = useId()
  const storyBackgroundsSettings = settings.storyBackgroundsSettings ?? {
    enabled: false,
    defaultImageProfileId: null,
  }

  return (
    <SettingsCard
      title="Story Backgrounds"
      subtitle="AI-generated background images for your chats"
    >
      <div className="space-y-6">
        {/* Enabled Toggle */}
        <div>
          <label className="flex items-start gap-3 p-4 border qt-border-default rounded qt-hover-accent cursor-pointer">
            <input
              type="checkbox"
              checked={storyBackgroundsSettings.enabled}
              onChange={(e) => onEnabledChange(e.target.checked)}
              disabled={saving}
              className="mt-1 qt-checkbox"
            />
            <div className="flex-1">
              <div className="font-medium qt-text">
                Enable Story Backgrounds
              </div>
              <div className="qt-text-small mt-1">
                Automatically generate atmospheric background images for your chats based on the
                story content and characters. Backgrounds are generated when the chat title is updated.
              </div>
            </div>
          </label>
        </div>

        {/* Image Profile Selection */}
        <div className="space-y-2">
          <label className="block font-medium qt-text" htmlFor={`${id}-image-profile`}>
            Image Generation Profile
          </label>
          <p className="qt-text-small">
            Choose which image generation profile to use for creating story backgrounds.
            If not set, will use the character&apos;s image profile or your default profile.
          </p>
          <select
            id={`${id}-image-profile`}
            value={storyBackgroundsSettings.defaultImageProfileId ?? ''}
            onChange={(e) => onProfileChange(e.target.value || null)}
            disabled={saving || loadingProfiles || !storyBackgroundsSettings.enabled}
            className="w-full max-w-md rounded-lg border qt-border-default qt-bg-card px-3 py-2 qt-text focus:qt-border-primary focus:outline-none focus:ring-1 qt-focus-ring disabled:opacity-50"
          >
            <option value="">Use default profile</option>
            {imageProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} ({profile.provider} - {profile.modelName})
              </option>
            ))}
          </select>
          {imageProfiles.length === 0 && !loadingProfiles && (
            <p className="qt-text-small qt-text-warning">
              No image profiles configured. Please create an image generation profile in the Profiles settings.
            </p>
          )}
        </div>

        {/* Info Box */}
        <div className="border qt-border-default rounded-lg p-4 qt-bg-muted/50">
          <h4 className="font-medium qt-text mb-2">How Story Backgrounds Work</h4>
          <ul className="qt-text-small space-y-1 list-disc list-inside">
            <li>Backgrounds are generated automatically when the chat title is updated</li>
            <li>The AI creates atmospheric landscape scenes featuring your characters as small figures</li>
            <li>Scenes are based on the chat title and character descriptions</li>
            <li>Generated images are saved to your file storage and linked to the chat</li>
            <li>Projects can inherit the latest chat background or use their own</li>
          </ul>
        </div>
      </div>
    </SettingsCard>
  )
}
