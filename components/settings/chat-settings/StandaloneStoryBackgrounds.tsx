'use client'

/**
 * Standalone Story Backgrounds Settings
 *
 * Thin wrapper that calls useChatSettings() internally so
 * StoryBackgroundsSettings can be rendered outside the ChatSettingsTab.
 *
 * @module components/settings/chat-settings/StandaloneStoryBackgrounds
 */

import { useChatSettings } from './hooks/useChatSettings'
import { StoryBackgroundsSettings } from './StoryBackgroundsSettings'

export function StandaloneStoryBackgrounds() {
  const {
    settings,
    loading,
    error,
    success,
    saving,
    imageProfiles,
    loadingProfiles,
    handleStoryBackgroundsEnabledChange,
    handleStoryBackgroundsProfileChange,
  } = useChatSettings()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">Loading settings...</div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="qt-alert-error py-8">
        Failed to load story backgrounds settings
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && <div className="qt-alert-error">{error}</div>}
      {success && <div className="qt-alert-success">Settings saved successfully</div>}
      <StoryBackgroundsSettings
        settings={settings}
        saving={saving}
        loadingProfiles={loadingProfiles}
        imageProfiles={imageProfiles}
        onEnabledChange={handleStoryBackgroundsEnabledChange}
        onProfileChange={handleStoryBackgroundsProfileChange}
      />
    </div>
  )
}
