'use client'

/**
 * The Inventory a Workbench vantage looks at — the Inventory twin of
 * `useWardrobeVantageItems`, over the same vantage (`WardrobeVantage`, which
 * the one `WardrobeVantageSelect` sets).
 *
 * A character vantage reads that character's whole reachable pool (the
 * character tier's `?shared=true` listing: own vault, groups, General — no
 * project tier, the Workbench has no chat); a container vantage reads that
 * one shared tier. Archived objects are always included, flagged, so a
 * reference to a retired object still resolves and can say so.
 *
 * Keys through `queryKeys.inventory.list` via `useInventoryList`, so this adds
 * no query key, no route and no polling site.
 *
 * @module lib/hooks/use-inventory-vantage-items
 */

import { useMemo } from 'react'
import { useInventoryList } from '@/lib/hooks/use-inventory'
import { isInContainer, type InventoryContainer } from '@/lib/inventory/container'
import type { ResolvedInventoryPool } from '@/lib/inventory/refs'
import type { WardrobeVantage } from '@/lib/pascal/tool-draft'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'

export interface UseInventoryVantageItemsResult {
  items: ResolvedInventoryItem[]
  /** The pool as `resolveInventoryRef` reads it: own = the vantage's own tier. */
  pool: ResolvedInventoryPool
  loading: boolean
  /** True once the read has settled; false for the `none` vantage. */
  fetched: boolean
}

/** Load the vantage's Inventory. `null` (or the `none` vantage) reads nothing. */
export function useInventoryVantageItems(vantage: WardrobeVantage | null): UseInventoryVantageItemsResult {
  const container: InventoryContainer | null =
    vantage?.kind === 'character'
      ? { scope: 'character', id: vantage.characterId }
      : vantage?.kind === 'container'
        ? vantage.container
        : null
  const list = useInventoryList(container, { includeArchived: true, shared: vantage?.kind === 'character' })
  const scope = container?.scope ?? null
  const containerId = container?.id ?? null

  const pool = useMemo<ResolvedInventoryPool>(() => {
    const own = new Set(
      scope
        ? list.items.filter((item) => isInContainer(item, { scope, id: containerId } as InventoryContainer)).map((item) => item.id)
        : [],
    )
    return { items: list.items, owns: (id) => own.has(id) }
  }, [list.items, scope, containerId])

  return { items: list.items, pool, loading: list.loading, fetched: container !== null && !list.loading }
}
