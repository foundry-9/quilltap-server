'use client'

import { PhysicalDescriptionList } from '@/components/physical-descriptions'
import { ClothingRecordList } from '@/components/clothing-records'
import { WardrobeItemList } from '@/components/wardrobe'

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
      <WardrobeItemList
        characterId={characterId}
      />
    </div>
  )
}
