'use client'

/**
 * Atlas Card
 *
 * Per-project Atlas card on the Prospero project page: the shared Atlas
 * browser on this project's store — the named things of this project's
 * world, told to every character in its chats whenever one is spoken of. The
 * same editor, folders, pictures and transfers the Atlas dialog offers when
 * it browses a project.
 *
 * @module app/prospero/[id]/components/AtlasCard
 */

import { useMemo } from 'react'
import { ChevronIcon } from '@/components/ui/ChevronIcon'
import { Icon } from '@/components/ui/icon'
import { useAtlasList } from '@/lib/hooks/use-atlas'
import type { AtlasContainer } from '@/lib/atlas/container'
import { AtlasPanel } from '@/components/atlas/atlas-control-dialog'

interface AtlasCardProps {
  projectId: string
  expanded: boolean
  onToggle: () => void
}

export function AtlasCard({ projectId, expanded, onToggle }: AtlasCardProps) {
  const container = useMemo<AtlasContainer>(() => ({ scope: 'project', id: projectId }), [projectId])
  const { entries } = useAtlasList(container, { includeArchived: false })

  return (
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon name="atlas" className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 qt-text">The Atlas ({entries.length})</h3>
            <p className="qt-text-small qt-text-secondary">
              The vehicles, houses, devices and places of this project&rsquo;s world
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>
      {expanded && (
        <div className="border-t qt-border-default p-4">
          <AtlasPanel container={container} />
        </div>
      )}
    </div>
  )
}
