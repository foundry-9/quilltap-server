'use client'

import { MemoryList } from '@/components/memory/memory-list'

interface MemoriesTabProps {
  characterId: string
  refreshKey?: number
}

export function MemoriesTab({ characterId, refreshKey }: MemoriesTabProps) {
  return <MemoryList characterId={characterId} refreshKey={refreshKey} />
}
