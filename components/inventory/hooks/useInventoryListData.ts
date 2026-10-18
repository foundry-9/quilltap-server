'use client'

/**
 * The Inventory browser's data: the objects of the tier being browsed — for
 * a character, the character's whole reachable pool (own vault, groups, the
 * project tier when one is named, General), each object tagged with its tier
 * — and the one "is this managed here" predicate the rows and the folder
 * view key on.
 *
 * @module components/inventory/hooks/useInventoryListData
 */

import { useCallback } from 'react'
import { useInventoryList } from '@/lib/hooks/use-inventory'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import type { InventoryContainer } from '@/lib/inventory/container'

export function useInventoryListData(
  container: InventoryContainer | null,
  opts: { includeArchived: boolean; projectId?: string | null },
) {
  const { items, loading } = useInventoryList(container, {
    includeArchived: opts.includeArchived,
    shared: container?.scope === 'character',
    projectId: opts.projectId ?? null,
  })

  /** True when the object lives in the tier being browsed. */
  const canManage = useCallback(
    (item: ResolvedInventoryItem): boolean => {
      if (!container) return false
      if (container.scope !== 'character') return true
      return !item.origin || (item.origin.scope === 'character' && item.origin.id === container.id)
    },
    [container],
  )

  return { items, loading, canManage }
}

export type InventoryListData = ReturnType<typeof useInventoryListData>
