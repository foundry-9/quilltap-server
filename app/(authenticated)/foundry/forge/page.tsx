'use client'

import Link from 'next/link'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import ApiKeysTab from '@/components/settings/api-keys-tab'
import ConnectionProfilesTab from '@/components/settings/connection-profiles-tab'
import PluginsTab from '@/components/settings/plugins-tab'
import StorageTab from '@/components/settings/storage-tab'
import BackupRestoreCard from '@/components/tools/backup-restore-card'
import { ImportExportCard } from '@/components/tools/import-export-card'
import { DeleteDataCard } from '@/components/tools/delete-data-card'

export default function ForgePage() {
  return (
    <div className="qt-page-container" style={{ '--story-background-url': 'url(/images/foundry.png)' } as React.CSSProperties}>
      <div className="mb-2">
        <nav className="qt-text-small qt-text-muted">
          <Link href="/foundry" className="qt-link">The Foundry</Link>
          <span className="mx-2">/</span>
          <span>The Forge</span>
        </nav>
      </div>
      <div className="mb-8">
        <h1 className="qt-heading-1">The Forge</h1>
        <p className="qt-text-muted mt-2">API keys, connections, plugins, storage, and data management</p>
      </div>

      <div className="space-y-4">
        <CollapsibleCard title="API Keys" description="Manage API keys for LLM providers">
          <ApiKeysTab />
        </CollapsibleCard>

        <CollapsibleCard title="Connection Profiles" description="Configure LLM connection profiles">
          <ConnectionProfilesTab />
        </CollapsibleCard>

        <CollapsibleCard title="Plugins" description="Install and manage plugins">
          <PluginsTab />
        </CollapsibleCard>

        <CollapsibleCard title="File Storage" description="Configure file storage settings">
          <StorageTab />
        </CollapsibleCard>

        <CollapsibleCard title="Backup & Restore" description="Create and restore backups of your data">
          <BackupRestoreCard />
        </CollapsibleCard>

        <CollapsibleCard title="Import / Export" description="Import and export characters, chats, and settings">
          <ImportExportCard />
        </CollapsibleCard>

        <CollapsibleCard title="Delete All Data" description="Permanently delete all application data">
          <DeleteDataCard />
        </CollapsibleCard>
      </div>
    </div>
  )
}
