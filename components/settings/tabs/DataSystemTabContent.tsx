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

export function DataSystemTabContent() {
  const info = useSubsystemInfo('prospero')
  const {
    settings,
    loading,
    saving,
    handleLLMLoggingChange,
  } = useChatSettingsContext()

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        {info.thumbnail && (
          <img src={info.thumbnail} alt="" className="w-10 h-10 rounded-lg object-cover opacity-60" />
        )}
        <p className="qt-text-small qt-text-muted italic">{info.description}</p>
      </div>

      <div className="space-y-4">
        <CollapsibleCard title="Plugins" description="Install and manage plugins">
          <PluginsTab />
        </CollapsibleCard>

<CollapsibleCard title="Backup & Restore" description="Create and restore backups of your data">
          <BackupRestoreCard />
        </CollapsibleCard>

        <CollapsibleCard title="Import / Export" description="Import and export characters, chats, and settings">
          <ImportExportCard />
        </CollapsibleCard>

        <CollapsibleCard title="LLM Logging" description="Configure LLM request logging">
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

        <CollapsibleCard title="Tasks Queue" description="View and manage background tasks">
          <TasksQueueCard />
        </CollapsibleCard>

        <CollapsibleCard title="LLM Logs" description="View detailed logs of LLM requests and responses">
          <LLMLogsCard />
        </CollapsibleCard>

        <CollapsibleCard title="Delete All Data" description="Permanently delete all application data">
          <DeleteDataCard />
        </CollapsibleCard>
      </div>
    </div>
  )
}
