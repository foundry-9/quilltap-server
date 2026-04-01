'use client'

import { MemoryList } from '@/components/memory/memory-list'

interface MemoriesTabProps {
  characterId: string
}

export function MemoriesTab({ characterId }: MemoriesTabProps) {
  return <MemoryList characterId={characterId} />
}
