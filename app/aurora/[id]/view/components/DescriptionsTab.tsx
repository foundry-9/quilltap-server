'use client'

import { PhysicalDescriptionList } from '@/components/physical-descriptions'
import { ClothingRecordList } from '@/components/clothing-records'

interface DescriptionsTabProps {
  characterId: string
  overlayActive?: boolean
}

export function DescriptionsTab({ characterId, overlayActive = false }: DescriptionsTabProps) {
  return (
    <div className="space-y-8">
      {overlayActive && (
        <div className="qt-card qt-bg-muted">
          <p className="text-sm text-foreground">
            <strong>Scriptorium overlay is active.</strong> The first physical description&rsquo;s
            <em> full description</em> and four <em>prompts</em> are read live from this character&rsquo;s
            <code className="mx-1">physical-description.md</code> and
            <code className="mx-1">physical-prompts.json</code>. Edits saved here are stored in the database
            but are masked by the vault until the switch is off or you run <em>Sync from vault</em>.
          </p>
        </div>
      )}
      <PhysicalDescriptionList
        entityType="character"
        entityId={characterId}
      />
      <ClothingRecordList
        entityId={characterId}
      />
    </div>
  )
}
