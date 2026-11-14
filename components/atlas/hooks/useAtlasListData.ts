'use client'

/**
 * The Atlas browser's data: the entries of the tier being browsed. Unlike the
 * Inventory, a character's tier lists only the character's own entries — the
 * Atlas has no merged view — so every row is managed here; the predicate is
 * kept so the rows and the folder view read as the other browsers' do.
 *
 * @module components/atlas/hooks/useAtlasListData
 */

import { useCallback } from 'react'
import { useAtlasList } from '@/lib/hooks/use-atlas'
import type { AtlasEntryWithOrigin } from '@/lib/schemas/atlas.types'
import type { AtlasContainer } from '@/lib/atlas/container'

export function useAtlasListData(container: AtlasContainer | null, opts: { includeArchived: boolean }) {
  const { entries, loading } = useAtlasList(container, { includeArchived: opts.includeArchived })

  /** True when the entry lives in the tier being browsed. */
  const canManage = useCallback(
    (entry: AtlasEntryWithOrigin): boolean => {
      if (!container) return false
      if (!entry.origin) return true
      if (entry.origin.scope !== container.scope) return false
      return container.scope === 'general' || entry.origin.id === container.id
    },
    [container],
  )

  return { entries, loading, canManage }
}

export type AtlasListData = ReturnType<typeof useAtlasListData>
