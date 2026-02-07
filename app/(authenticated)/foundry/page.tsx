'use client'

import Link from 'next/link'
import BackupRestoreCard from '@/components/tools/backup-restore-card'
import { ImportExportCard } from '@/components/tools/import-export-card'
import { DeleteDataCard } from '@/components/tools/delete-data-card'
import { CapabilitiesReportCard } from '@/components/tools/capabilities-report-card'
import { TasksQueueCard } from '@/components/tools/tasks-queue-card'
import LLMLogsCard from '@/components/tools/llm-logs-card'
import { BrandName } from '@/components/ui/brand-name'

export default function ToolsPage() {
  return (
    <div className="qt-page-container">
      {/* Header */}
      <div className="mb-8">
        <h1 className="qt-heading-1">Tools</h1>
        <p className="qt-text-muted mt-2">Utility tools for managing your <BrandName /> data</p>
      </div>

      {/* Tool Cards Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        <BackupRestoreCard />
        <ImportExportCard />
        <CapabilitiesReportCard />
        <TasksQueueCard />
        <LLMLogsCard />
        <DeleteDataCard />
      </div>

      {/* Back Link */}
      <div className="mt-8">
        <Link href="/" className="qt-link">
          ← Back to Home
        </Link>
      </div>
    </div>
  )
}
