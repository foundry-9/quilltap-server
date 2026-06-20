'use client'

import { useCallback, useState } from 'react'
import type { CharacterStats, GroupBadge } from '../types'

interface UseCharacterStatsReturn {
  stats: CharacterStats | null
  groups: GroupBadge[]
  fetchStats: () => Promise<void>
}

/**
 * Fetches the aggregate counts (memories, conversations, wardrobe, photos,
 * scenarios, knowledge, core) plus the character's group memberships for the
 * Aurora header card. Kept separate from {@link useCharacterView} so the
 * header's secondary stats don't block the primary character load.
 */
export function useCharacterStats(characterId: string): UseCharacterStatsReturn {
  const [stats, setStats] = useState<CharacterStats | null>(null)
  const [groups, setGroups] = useState<GroupBadge[]>([])

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/characters/${characterId}?action=stats`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to fetch character stats')
      const data = await res.json()
      setStats(data.stats ?? null)
      setGroups(data.groups ?? [])
    } catch (err) {
      console.error('Failed to fetch character stats', { error: err instanceof Error ? err.message : String(err), characterId })
    }
  }, [characterId])

  return { stats, groups, fetchStats }
}
