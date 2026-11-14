'use client'

/**
 * Card bodies for the Context & Memory group.
 *
 * @module components/settings/cards/context-memory-cards
 */

import { ContextCompressionSettingsComponent } from '@/components/settings/chat-settings/ContextCompressionSettings'
import { MemoryCascadeSettings } from '@/components/settings/chat-settings/MemoryCascadeSettings'
import { DataRetentionSettings } from '@/components/settings/chat-settings/DataRetentionSettings'
import { WithChatSettings } from './with-chat-settings'

export { MemoryMaintenanceCard } from '@/components/tools/memory-maintenance-card'
export { MemoryExtractionGrainCard } from '@/components/tools/memory-extraction-grain-card'
export { MemoryRecallCard } from '@/components/tools/memory-recall-card'
export { MemoryBackfillCard } from '@/components/tools/memory-backfill-card'
export { MemoryRegenerateCard } from '@/components/tools/memory-regenerate-card'
export { ConversationSummaryRegenerateCard } from '@/components/tools/conversation-summary-regenerate-card'

export function ContextCompressionCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleContextCompressionUpdate }) => (
        <ContextCompressionSettingsComponent settings={settings} saving={saving} onUpdate={handleContextCompressionUpdate} />
      )}
    </WithChatSettings>
  )
}

export function MemoryCascadeCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleMemoryCascadeUpdate }) => (
        <MemoryCascadeSettings settings={settings} saving={saving} onUpdate={handleMemoryCascadeUpdate} />
      )}
    </WithChatSettings>
  )
}

export function DataRetentionCard() {
  return <DataRetentionSettings />
}
