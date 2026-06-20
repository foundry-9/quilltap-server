'use client'

/**
 * Wardrobe Card
 *
 * Per-project Wardrobe management card on the Prospero project page. Mirrors
 * ScenariosCard: the collapsible header lives here, the CRUD body is rendered
 * by `ProjectWardrobeManager`, fed by the project-scoped `useProjectWardrobe`
 * hook. Items created here are the project tier of the tri-tier wardrobe model.
 *
 * @module app/prospero/[id]/components/WardrobeCard
 */

import { ChevronIcon } from '@/components/ui/ChevronIcon'
import { ProjectWardrobeManager } from '@/components/wardrobe/ProjectWardrobeManager'
import { useProjectWardrobe } from '../hooks'
import { Icon } from '@/components/ui/icon'

interface WardrobeCardProps {
  projectId: string
  expanded: boolean
  onToggle: () => void
}


export function WardrobeCard({ projectId, expanded, onToggle }: WardrobeCardProps) {
  const mutator = useProjectWardrobe(projectId)

  return (
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon name="wardrobe" className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 text-foreground">Wardrobe ({mutator.items.length})</h3>
            <p className="qt-text-small qt-text-secondary">
              Shared garments every character in this project can wear
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>

      {expanded && (
        <div className="border-t qt-border-default p-4">
          <ProjectWardrobeManager mutator={mutator} />
        </div>
      )}
    </div>
  )
}
