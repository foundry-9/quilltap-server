'use client'

/**
 * Scenarios Card
 *
 * Per-project Scenarios management card on the Prospero project page. The
 * collapsible header lives here; the CRUD body is rendered by the shared
 * `ScenariosManager`, fed by the project-scoped `useProjectScenarios` hook.
 *
 * @module app/prospero/[id]/components/ScenariosCard
 */

import { ChevronIcon } from '@/components/ui/ChevronIcon'
import { ScenariosIcon } from '@/components/scenarios/ScenariosIcon'
import { ScenariosManager } from '@/components/scenarios/ScenariosManager'
import { useProjectScenarios } from '../hooks'

interface ScenariosCardProps {
  projectId: string
  expanded: boolean
  onToggle: () => void
}

export function ScenariosCard({ projectId, expanded, onToggle }: ScenariosCardProps) {
  const mutator = useProjectScenarios(projectId)

  return (
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <ScenariosIcon className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 text-foreground">Scenarios ({mutator.scenarios.length})</h3>
            <p className="qt-text-small qt-text-secondary">
              Reusable starting scenes for new chats in this project
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>

      {expanded && (
        <div className="border-t qt-border-default p-4">
          <ScenariosManager
            mutator={mutator}
            scopeLabel="project"
            emptyMessage="No scenarios yet. Create one and it'll be offered when starting new chats in this project."
          />
        </div>
      )}
    </div>
  )
}
