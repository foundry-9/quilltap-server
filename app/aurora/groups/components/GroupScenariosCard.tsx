'use client'

/**
 * Group Scenarios Card
 *
 * The group's `Scenarios/` shelf on its page, collapsible like the Members and
 * Linked Stores cards beside it. The CRUD body is the shared
 * `ScenariosManager` (the same one the project card and the General page
 * render), fed by `useScenarioMutator` over `/api/v1/groups/[id]/scenarios`.
 *
 * @module app/aurora/groups/components/GroupScenariosCard
 */

import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { ScenariosIcon } from '@/components/scenarios/ScenariosIcon'
import { ScenariosManager } from '@/components/scenarios/ScenariosManager'
import { useScenarioMutator } from '@/components/scenarios/use-scenario-mutator'

interface GroupScenariosCardProps {
  groupId: string
  expanded: boolean
  onToggle: () => void
}

export function GroupScenariosCard({ groupId, expanded, onToggle }: GroupScenariosCardProps) {
  const mutator = useScenarioMutator(`/api/v1/groups/${groupId}/scenarios`)

  return (
    <CollapsibleCard
      icon={<ScenariosIcon className="w-5 h-5 qt-text-primary" />}
      title={`Scenarios (${mutator.scenarios.length})`}
      description="Reusable starting scenes offered whenever a member takes a seat"
      isOpen={expanded}
      onOpenChange={() => onToggle()}
    >
      <ScenariosManager
        mutator={mutator}
        scopeLabel="group"
        shelf={{ kind: 'group', groupId }}
        emptyMessage="No scenarios yet. Create one and it'll be offered whenever a member of this group joins a new chat."
      />
    </CollapsibleCard>
  )
}
