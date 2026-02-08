'use client'

import Link from 'next/link'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { TasksQueueCard } from '@/components/tools/tasks-queue-card'
import { CapabilitiesReportCard } from '@/components/tools/capabilities-report-card'
import LLMLogsCard from '@/components/tools/llm-logs-card'

export default function ProsperoPage() {
  return (
    <div className="qt-page-container">
      <div className="mb-2">
        <nav className="qt-text-small qt-text-muted">
          <Link href="/foundry" className="qt-link">The Foundry</Link>
          <span className="mx-2">/</span>
          <span>Prospero</span>
        </nav>
      </div>
      <div className="mb-8">
        <h1 className="qt-heading-1">Prospero</h1>
        <p className="qt-text-muted mt-2">Task queue, capabilities report, and LLM logs</p>
      </div>

      <div className="space-y-4">
        <CollapsibleCard title="Tasks Queue" description="View and manage background tasks">
          <TasksQueueCard />
        </CollapsibleCard>

        <CollapsibleCard title="Capabilities Report" description="View LLM provider capabilities and feature support">
          <CapabilitiesReportCard />
        </CollapsibleCard>

        <CollapsibleCard title="LLM Logs" description="View detailed logs of LLM requests and responses">
          <LLMLogsCard />
        </CollapsibleCard>
      </div>
    </div>
  )
}
