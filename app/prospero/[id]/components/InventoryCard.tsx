'use client'

/**
 * Inventory Card
 *
 * Per-project Inventory card on the Prospero project page: the shared
 * Inventory browser on this project's store — its objects, kits and
 * archetypes, carried by (or instantiated for) every character in this
 * project's chats. The same editor, folders, pictures and transfers the
 * Inventory dialog offers when it browses a project.
 *
 * @module app/prospero/[id]/components/InventoryCard
 */

import { useMemo } from 'react'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Icon } from '@/components/ui/icon'
import { useInventoryList } from '@/lib/hooks/use-inventory'
import type { InventoryContainer } from '@/lib/inventory/container'
import { InventoryPanel } from '@/components/inventory/inventory-control-dialog'

interface InventoryCardProps {
  projectId: string
  expanded: boolean
  onToggle: () => void
}

export function InventoryCard({ projectId, expanded, onToggle }: InventoryCardProps) {
  const container = useMemo<InventoryContainer>(() => ({ scope: 'project', id: projectId }), [projectId])
  const { items } = useInventoryList(container, { includeArchived: false })

  return (
    <CollapsibleCard
      icon={<Icon name="inventory" className="w-5 h-5 qt-text-primary" />}
      title={`Inventory (${items.length})`}
      description="Objects, kits and archetypes every character in this project can carry"
      isOpen={expanded}
      onOpenChange={() => onToggle()}
    >
      <InventoryPanel container={container} projectId={projectId} />
    </CollapsibleCard>
  )
}
