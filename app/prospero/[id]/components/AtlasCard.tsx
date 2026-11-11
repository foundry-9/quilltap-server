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
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
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
    <CollapsibleCard
      icon={<Icon name="atlas" className="w-5 h-5 qt-text-primary" />}
      title={`The Atlas (${entries.length})`}
      description="The vehicles, houses, devices and places of this project’s world"
      isOpen={expanded}
      onOpenChange={() => onToggle()}
    >
      <AtlasPanel container={container} />
    </CollapsibleCard>
  )
}
