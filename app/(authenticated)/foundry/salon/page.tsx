'use client'

import Link from 'next/link'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { useChatSettings } from '@/components/settings/chat-settings/hooks/useChatSettings'
import { AvatarSettings } from '@/components/settings/chat-settings/AvatarSettings'
import { CheapLLMSettings } from '@/components/settings/chat-settings/CheapLLMSettings'
import { ImageDescriptionSettings } from '@/components/settings/chat-settings/ImageDescriptionSettings'
import { MemoryCascadeSettings } from '@/components/settings/chat-settings/MemoryCascadeSettings'
import { TokenDisplaySettingsComponent } from '@/components/settings/chat-settings/TokenDisplaySettings'
import { ContextCompressionSettingsComponent } from '@/components/settings/chat-settings/ContextCompressionSettings'
import { LLMLoggingSettingsComponent } from '@/components/settings/chat-settings/LLMLoggingSettings'
import { AutomationSettings } from '@/components/settings/chat-settings/AutomationSettings'
import { AgentModeSettings } from '@/components/settings/chat-settings/AgentModeSettings'

export default function SalonPage() {
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

  const bgStyle = { '--story-background-url': 'url(/images/salon.png)' } as React.CSSProperties

  if (loading) {
    return (
      <div className="qt-page-container" style={bgStyle}>
        <div className="flex items-center justify-center py-8">
          <div className="text-muted-foreground">Loading settings...</div>
        </div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="qt-page-container" style={bgStyle}>
        <div className="qt-alert-error py-8">Failed to load chat settings</div>
      </div>
    )
  }

  return (
    <div className="qt-page-container" style={bgStyle}>
      <div className="mb-2">
        <nav className="qt-text-small qt-text-muted">
          <Link href="/foundry" className="qt-link">The Foundry</Link>
          <span className="mx-2">/</span>
          <span>The Salon</span>
        </nav>
      </div>
      <div className="mb-8">
        <h1 className="qt-heading-1">The Salon</h1>
        <p className="qt-text-muted mt-2">Chat behavior, avatars, compression, and automation settings</p>
      </div>

      {error && <div className="qt-alert-error mb-4">{error}</div>}
      {success && <div className="qt-alert-success mb-4">Settings saved successfully</div>}

      <div className="space-y-4">
        <CollapsibleCard title="Avatar Settings" description="Configure avatar display mode and style">
          <AvatarSettings
            settings={settings}
            saving={saving}
            onAvatarModeChange={handleAvatarModeChange}
            onAvatarStyleChange={handleAvatarStyleChange}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Cheap LLM Settings" description="Configure the lightweight LLM used for background tasks">
          <CheapLLMSettings
            settings={settings}
            saving={saving}
            loadingProfiles={loadingProfiles}
            connectionProfiles={connectionProfiles}
            embeddingProfiles={embeddingProfiles}
            onUpdate={handleCheapLLMUpdate}
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

        <CollapsibleCard title="Memory Cascade" description="Control how memories behave when messages change">
          <MemoryCascadeSettings
            settings={settings}
            saving={saving}
            onUpdate={handleMemoryCascadeUpdate}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Context Compression" description="Configure how older messages are compressed">
          <ContextCompressionSettingsComponent
            settings={settings}
            saving={saving}
            onUpdate={handleContextCompressionUpdate}
          />
        </CollapsibleCard>

        <CollapsibleCard title="LLM Logging" description="Configure LLM request logging">
          <LLMLoggingSettingsComponent
            settings={settings}
            saving={saving}
            onLLMLoggingChange={handleLLMLoggingChange}
          />
        </CollapsibleCard>

        <CollapsibleCard title="Token Display" description="Configure token count and cost display">
          <TokenDisplaySettingsComponent
            settings={settings}
            saving={saving}
            onTokenDisplayChange={handleTokenDisplayChange}
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
      </div>
    </div>
  )
}
