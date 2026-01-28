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
        <h1 className="text-3xl font-bold">Tools</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Utility tools for managing your <BrandName /> data</p>
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
        <Link
          href="/"
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          ← Back to Home
        </Link>
      </div>
    </div>
  )
}
