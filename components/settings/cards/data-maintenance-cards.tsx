'use client'

/**
 * Card bodies for the Data & Maintenance group.
 *
 * @module components/settings/cards/data-maintenance-cards
 */

import { LLMLoggingSettingsComponent } from '@/components/settings/chat-settings/LLMLoggingSettings'
import { WithChatSettings } from './with-chat-settings'

export { default as PluginsCard } from '@/components/settings/plugins-tab'
export { default as BackupRestoreCard } from '@/components/tools/backup-restore-card'
export { ImportExportCard } from '@/components/tools/import-export-card'
export { TasksQueueCard } from '@/components/tools/tasks-queue-card'
export { default as LLMLogsCard } from '@/components/tools/llm-logs-card'
export { CapabilitiesReportCard } from '@/components/tools/capabilities-report-card'

export function LLMLoggingCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleLLMLoggingChange }) => (
        <LLMLoggingSettingsComponent settings={settings} saving={saving} onLLMLoggingChange={handleLLMLoggingChange} />
      )}
    </WithChatSettings>
  )
}
