'use client'

import { useSubsystemInfo } from '@/components/providers/theme-provider'
import { useChatSettingsContext } from '@/components/settings/chat-settings/ChatSettingsProvider'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import PluginsTab from '@/components/settings/plugins-tab'
import BackupRestoreCard from '@/components/tools/backup-restore-card'
import { ImportExportCard } from '@/components/tools/import-export-card'
import { LLMLoggingSettingsComponent } from '@/components/settings/chat-settings/LLMLoggingSettings'
import { TasksQueueCard } from '@/components/tools/tasks-queue-card'
import LLMLogsCard from '@/components/tools/llm-logs-card'
import { DeleteDataCard } from '@/components/tools/delete-data-card'
import { ChangePassphraseCard } from '@/components/settings/ChangePassphraseCard'
import { useSettingsSection } from './useSettingsSection'

export function DataSystemTabContent() {
  const info = useSubsystemInfo('prospero')
  const activeSection = useSettingsSection()
  const {
    settings,
    loading,
    saving,
    handleLLMLoggingChange,
  } = useChatSettingsContext()

  return (
    <div>
      <p className="qt-text-small qt-text-muted italic mb-6">{info.description}</p>

      <div className="space-y-4">
        <CollapsibleCard title="Encryption Passphrase" description="Change or remove the passphrase protecting your encryption key" sectionId="encryption-passphrase" forceOpen={activeSection === 'encryption-passphrase'}>
          <ChangePassphraseCard />
        </CollapsibleCard>

        <CollapsibleCard title="Plugins" description="Install and manage plugins" sectionId="plugins" forceOpen={activeSection === 'plugins'}>
          <PluginsTab />
        </CollapsibleCard>

        <CollapsibleCard title="Backup & Restore" description="Create and restore backups of your data" sectionId="backup-restore" forceOpen={activeSection === 'backup-restore'}>
          <BackupRestoreCard />
        </CollapsibleCard>

        <CollapsibleCard title="Import / Export" description="Import and export characters, chats, and settings" sectionId="import-export" forceOpen={activeSection === 'import-export'}>
          <ImportExportCard />
        </CollapsibleCard>

        <CollapsibleCard title="LLM Logging" description="Configure LLM request logging" sectionId="llm-logging" forceOpen={activeSection === 'llm-logging'}>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">Loading settings...</div>
            </div>
          ) : settings ? (
            <LLMLoggingSettingsComponent
              settings={settings}
              saving={saving}
              onLLMLoggingChange={handleLLMLoggingChange}
            />
          ) : (
            <div className="qt-alert-error">Failed to load settings</div>
          )}
        </CollapsibleCard>

        <CollapsibleCard title="Tasks Queue" description="View and manage background tasks" sectionId="tasks-queue" forceOpen={activeSection === 'tasks-queue'}>
          <TasksQueueCard />
        </CollapsibleCard>

        <CollapsibleCard title="LLM Logs" description="View detailed logs of LLM requests and responses" sectionId="llm-logs" forceOpen={activeSection === 'llm-logs'}>
          <LLMLogsCard />
        </CollapsibleCard>

        <CollapsibleCard title="Delete All Data" description="Permanently delete all application data" sectionId="delete-all-data" forceOpen={activeSection === 'delete-all-data'}>
          <DeleteDataCard />
        </CollapsibleCard>
      </div>
    </div>
  )
}
