'use client'

import { PhysicalDescriptionList } from '@/components/physical-descriptions'

interface DescriptionsTabProps {
  characterId: string
}

export function DescriptionsTab({ characterId }: DescriptionsTabProps) {
  return (
    <PhysicalDescriptionList
      entityType="character"
      entityId={characterId}
    />
  )
}
