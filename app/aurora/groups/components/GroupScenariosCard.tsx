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

import { ChevronIcon } from '@/components/ui/ChevronIcon'
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
    <div className="qt-card qt-bg-card qt-border rounded-lg">
      <button
        onClick={onToggle}
        className={`w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors ${
          expanded ? 'rounded-t-lg' : 'rounded-lg'
        }`}
      >
        <div className="flex items-center gap-3">
          <ScenariosIcon className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 text-foreground">Scenarios ({mutator.scenarios.length})</h3>
            <p className="qt-text-small qt-text-secondary">
              Reusable starting scenes offered whenever a member takes a seat
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>

      {expanded && (
        <div className="border-t qt-border-default p-4">
          <ScenariosManager
            mutator={mutator}
            scopeLabel="group"
            shelf={{ kind: 'group', groupId }}
            emptyMessage="No scenarios yet. Create one and it'll be offered whenever a member of this group joins a new chat."
          />
        </div>
      )}
    </div>
  )
}
