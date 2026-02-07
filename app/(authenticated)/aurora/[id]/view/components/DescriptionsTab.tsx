'use client'

import { PhysicalDescriptionList } from '@/components/physical-descriptions'
import { ClothingRecordList } from '@/components/clothing-records'

interface DescriptionsTabProps {
  characterId: string
}

export function DescriptionsTab({ characterId }: DescriptionsTabProps) {
  return (
    <div className="space-y-8">
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
