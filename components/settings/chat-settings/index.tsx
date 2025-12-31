'use client'

import { useChatSettings } from './hooks/useChatSettings'
import { AvatarSettings } from './AvatarSettings'
import { CheapLLMSettings } from './CheapLLMSettings'
import { ImageDescriptionSettings } from './ImageDescriptionSettings'
import { MemoryCascadeSettings } from './MemoryCascadeSettings'

/**
 * ChatSettingsTab Component
 * Main tab component for managing all chat-related settings including:
 * - Avatar display modes and styles
 * - Cheap LLM configuration
 * - Image description profiles
 * - Memory cascade behavior
 */
export default function ChatSettingsTab() {
  const {
    settings,
    loading,
    error,
    success,
    saving,
    connectionProfiles,
    embeddingProfiles,
    loadingProfiles,
    handleAvatarModeChange,
    handleAvatarStyleChange,
    handleCheapLLMUpdate,
    handleImageDescriptionProfileChange,
    handleMemoryCascadeUpdate,
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
      <div className="text-red-600 dark:text-red-400 py-8">
        Failed to load chat settings
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="qt-alert-error">
          {error}
        </div>
      )}

      {success && (
        <div className="qt-alert-success">
          Settings saved successfully
        </div>
      )}

      <AvatarSettings
        settings={settings}
        saving={saving}
        onAvatarModeChange={handleAvatarModeChange}
        onAvatarStyleChange={handleAvatarStyleChange}
      />

      <CheapLLMSettings
        settings={settings}
        saving={saving}
        loadingProfiles={loadingProfiles}
        connectionProfiles={connectionProfiles}
        embeddingProfiles={embeddingProfiles}
        onUpdate={handleCheapLLMUpdate}
      />

      <ImageDescriptionSettings
        settings={settings}
        saving={saving}
        loadingProfiles={loadingProfiles}
        connectionProfiles={connectionProfiles}
        onProfileChange={handleImageDescriptionProfileChange}
      />

      <MemoryCascadeSettings
        settings={settings}
        saving={saving}
        onUpdate={handleMemoryCascadeUpdate}
      />
    </div>
  )
}
