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

import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { ScenariosIcon } from '@/components/scenarios/ScenariosIcon'
import { ScenariosManager } from '@/components/scenarios/ScenariosManager'
import { useProjectScenarios } from '../hooks'

interface ScenariosCardProps {
  projectId: string
  /** Offered as the Host's default save home ("Project: <name>"). */
  projectName?: string | null
  expanded: boolean
  onToggle: () => void
}

export function ScenariosCard({ projectId, projectName, expanded, onToggle }: ScenariosCardProps) {
  const mutator = useProjectScenarios(projectId)

  return (
    <CollapsibleCard
      icon={<ScenariosIcon className="w-5 h-5 qt-text-primary" />}
      title={`Scenarios (${mutator.scenarios.length})`}
      description="Reusable starting scenes for new chats in this project"
      isOpen={expanded}
      onOpenChange={() => onToggle()}
    >
      <ScenariosManager
        mutator={mutator}
        scopeLabel="project"
        shelf={{ kind: 'project', projectId, projectName }}
        emptyMessage="No scenarios yet. Create one and it'll be offered when starting new chats in this project."
      />
    </CollapsibleCard>
  )
}
