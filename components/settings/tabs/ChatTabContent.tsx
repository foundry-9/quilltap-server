'use client'

import { useSubsystemInfo } from '@/components/providers/theme-provider'
import { useChatSettingsContext } from '@/components/settings/chat-settings/ChatSettingsProvider'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { TokenDisplaySettingsComponent } from '@/components/settings/chat-settings/TokenDisplaySettings'
import { ContextCompressionSettingsComponent } from '@/components/settings/chat-settings/ContextCompressionSettings'
import { MemoryCascadeSettings } from '@/components/settings/chat-settings/MemoryCascadeSettings'
import { ImageDescriptionSettings } from '@/components/settings/chat-settings/ImageDescriptionSettings'
import { AutomationSettings } from '@/components/settings/chat-settings/AutomationSettings'
import { AgentModeSettings } from '@/components/settings/chat-settings/AgentModeSettings'
import { DangerousContentSettings } from '@/components/settings/chat-settings/DangerousContentSettings'

export function ChatTabContent() {
  const info = useSubsystemInfo('salon')
  const {
    settings,
    loading,
    saving,
    connectionProfiles,
    imageProfiles,
    loadingProfiles,
    handleTokenDisplayChange,
    handleContextCompressionUpdate,
    handleMemoryCascadeUpdate,
    handleImageDescriptionProfileChange,
    handleAutoDetectRngChange,
    handleAgentModeDefaultEnabledChange,
    handleAgentModeMaxTurnsChange,
    handleDangerousContentUpdate,
    handleCheapLLMUpdate,
  } = useChatSettingsContext()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">Loading settings...</div>
      </div>
    )
  }

  if (!settings) {
    return <div className="qt-alert-error">Failed to load chat settings</div>
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        {info.thumbnail && (
          <img src={info.thumbnail} alt="" className="w-10 h-10 rounded-lg object-cover opacity-60" />
        )}
        <p className="qt-text-small qt-text-muted italic">{info.description}</p>
      </div>

      <div className="space-y-4">
        <CollapsibleCard title="Token Display" description="Configure token count and cost display">
          <TokenDisplaySettingsComponent
            settings={settings}
            saving={saving}
            onTokenDisplayChange={handleTokenDisplayChange}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Context Compression" description="Configure how older messages are compressed">
          <ContextCompressionSettingsComponent
            settings={settings}
            saving={saving}
            onUpdate={handleContextCompressionUpdate}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Memory Cascade" description="Control how memories behave when messages change">
          <MemoryCascadeSettings
            settings={settings}
            saving={saving}
            onUpdate={handleMemoryCascadeUpdate}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Image Description" description="Configure image description generation">
          <ImageDescriptionSettings
            settings={settings}
            saving={saving}
            loadingProfiles={loadingProfiles}
            connectionProfiles={connectionProfiles}
            onProfileChange={handleImageDescriptionProfileChange}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Automation" description="Configure automatic detection features">
          <AutomationSettings
            settings={settings}
            saving={saving}
            onAutoDetectRngChange={handleAutoDetectRngChange}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Agent Mode" description="Configure iterative tool use with self-correction">
          <AgentModeSettings
            settings={settings}
            saving={saving}
            onDefaultEnabledChange={handleAgentModeDefaultEnabledChange}
            onMaxTurnsChange={handleAgentModeMaxTurnsChange}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Dangerous Content" description="Configure content detection, routing, and display behavior">
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
        </CollapsibleCard>
      </div>
    </div>
  )
}
