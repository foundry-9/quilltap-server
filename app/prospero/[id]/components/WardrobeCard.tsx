'use client'

/**
 * Wardrobe Card
 *
 * Per-project Wardrobe card on the Prospero project page. The collapsible
 * header lives here; the body is the shared wardrobe browser
 * (`WardrobeBrowser`) on this project's container — the same list, filters,
 * item editor, pictures, move/copy and dressing instructions the Wardrobe
 * dialog offers when it browses a project. Items here are the project tier:
 * wearable by every character in this project's chats.
 *
 * @module app/prospero/[id]/components/WardrobeCard
 */

import { useCallback, useMemo, useState } from 'react'
import { ChevronIcon } from '@/components/ui/ChevronIcon'
import { Icon } from '@/components/ui/icon'
import { showConfirmation } from '@/lib/alert'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'
import { WardrobeBrowser, WardrobeItemOverlays } from '@/components/wardrobe/WardrobeBrowser'
import { WardrobeInstructionsSection } from '@/components/wardrobe/WardrobeInstructionsSection'
import { useWardrobeListData } from '@/components/wardrobe/hooks/useWardrobeListData'
import { useWardrobeItemActions } from '@/components/wardrobe/hooks/useWardrobeItemActions'

interface WardrobeCardProps {
  projectId: string
  projectName?: string
  expanded: boolean
  onToggle: () => void
}

export function WardrobeCard({ projectId, projectName, expanded, onToggle }: WardrobeCardProps) {
  const container = useMemo<WardrobeContainer>(() => ({ scope: 'project', id: projectId }), [projectId])
  // "Show archived" is a different server read, not a client-side filter.
  const [showArchived, setShowArchived] = useState(false)
  const data = useWardrobeListData(container, { includeArchived: showArchived })
  const requestConfirmation = useCallback((message: string) => showConfirmation(message), [])
  const actions = useWardrobeItemActions({
    container,
    chatId: null,
    listItems: data.listItems,
    requestConfirmation,
  })

  return (
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon name="wardrobe" className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 text-foreground">Wardrobe ({data.listItems.length})</h3>
            <p className="qt-text-small qt-text-secondary">
              Shared garments every character in this project can wear
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>

      {expanded && (
        <div className="border-t qt-border-default p-4">
          <WardrobeInstructionsSection container={container} />
          <WardrobeBrowser
            container={container}
            data={data}
            actions={actions}
            showArchived={showArchived}
            onShowArchivedChange={setShowArchived}
            scrollList={false}
          />
        </div>
      )}

      <WardrobeItemOverlays
        container={container}
        containerLabel={projectName || 'This project'}
        data={data}
        actions={actions}
      />
    </div>
  )
}
