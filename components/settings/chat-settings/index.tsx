'use client'

import { useChatSettings } from './hooks/useChatSettings'
import { AvatarSettings } from './AvatarSettings'
import { CheapLLMSettings } from './CheapLLMSettings'
import { ImageDescriptionSettings } from './ImageDescriptionSettings'
import { MemoryCascadeSettings } from './MemoryCascadeSettings'
import { TokenDisplaySettingsComponent } from './TokenDisplaySettings'
import { ContextCompressionSettingsComponent } from './ContextCompressionSettings'
import { LLMLoggingSettingsComponent } from './LLMLoggingSettings'
import { AutomationSettings } from './AutomationSettings'
import { AgentModeSettings } from './AgentModeSettings'

/**
 * ChatSettingsTab Component
 * Main tab component for managing all chat-related settings including:
 * - Avatar display modes and styles
 * - Cheap LLM configuration
 * - Image description profiles
 * - Memory cascade behavior
 * - LLM logging preferences
 * - Context compression settings
 * - Token display preferences
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
    handleTokenDisplayChange,
    handleContextCompressionUpdate,
    handleLLMLoggingChange,
    handleAutoDetectRngChange,
    handleAgentModeDefaultEnabledChange,
    handleAgentModeMaxTurnsChange,
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

      <div className="qt-card-grid-auto">
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

        <ContextCompressionSettingsComponent
          settings={settings}
          saving={saving}
          onUpdate={handleContextCompressionUpdate}
        />

        <LLMLoggingSettingsComponent
          settings={settings}
          saving={saving}
          onLLMLoggingChange={handleLLMLoggingChange}
        />

        <TokenDisplaySettingsComponent
          settings={settings}
          saving={saving}
          onTokenDisplayChange={handleTokenDisplayChange}
        />

        <AutomationSettings
          settings={settings}
          saving={saving}
          onAutoDetectRngChange={handleAutoDetectRngChange}
        />

        <AgentModeSettings
          settings={settings}
          saving={saving}
          onDefaultEnabledChange={handleAgentModeDefaultEnabledChange}
          onMaxTurnsChange={handleAgentModeMaxTurnsChange}
        />
      </div>
    </div>
  )
}
