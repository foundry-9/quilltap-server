'use client'

/**
 * Standalone Dangerous Content Settings
 *
 * Thin wrapper that calls useChatSettings() internally so
 * DangerousContentSettings can be rendered outside the ChatSettingsTab.
 *
 * @module components/settings/chat-settings/StandaloneDangerousContent
 */

import { useChatSettings } from './hooks/useChatSettings'
import { DangerousContentSettings } from './DangerousContentSettings'

export function StandaloneDangerousContent() {
  const {
    settings,
    loading,
    error,
    success,
    saving,
    connectionProfiles,
    imageProfiles,
    loadingProfiles,
    handleDangerousContentUpdate,
    handleCheapLLMUpdate,
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
        Failed to load dangerous content settings
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && <div className="qt-alert-error">{error}</div>}
      {success && <div className="qt-alert-success">Settings saved successfully</div>}
      <DangerousContentSettings
        settings={settings}
        saving={saving}
        connectionProfiles={connectionProfiles}
        imageProfiles={imageProfiles}
        loadingProfiles={loadingProfiles}
        onUpdate={handleDangerousContentUpdate}
        imagePromptProfileId={settings.cheapLLMSettings.imagePromptProfileId}
        onImagePromptProfileChange={(id) => handleCheapLLMUpdate({ imagePromptProfileId: id })}
      />
    </div>
  )
}
