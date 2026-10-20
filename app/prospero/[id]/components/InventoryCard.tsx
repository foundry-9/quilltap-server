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
import { ChevronIcon } from '@/components/ui/ChevronIcon'
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
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon name="inventory" className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 text-foreground">Inventory ({items.length})</h3>
            <p className="qt-text-small qt-text-secondary">
              Objects, kits and archetypes every character in this project can carry
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>
      {expanded && (
        <div className="border-t qt-border-default p-4">
          <InventoryPanel container={container} projectId={projectId} />
        </div>
      )}
    </div>
  )
}
