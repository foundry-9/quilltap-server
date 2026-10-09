'use client'

/**
 * One wardrobe tier, read through TanStack Query.
 *
 * Every wardrobe list on the client is built from this hook: a container's own
 * collection (a character's vault, Quilltap General, a project's store, a
 * group's store) or a character's merged group tier. The key is
 * `queryKeys.wardrobe.list(tierKey, { includeArchived })`, so every list sits
 * under `queryKeys.wardrobe.all` and one prefix invalidation after a mutation
 * reaches them all. Each item carries the `origin` (and `wear`) the server
 * attached; nothing is merged here — the merging hooks
 * (`useCharacterWardrobeItems`, `useWardrobeContainerItems`) compose tiers.
 *
 * There is no realtime topic for wardrobe changes yet, so these lists refresh
 * on invalidation (after this client's own mutations) and on remount; they do
 * not poll.
 *
 * @module lib/hooks/use-wardrobe-tier
 */

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/query/fetcher'
import {
  wardrobeTierKey,
  wardrobeTierUrl,
  type WardrobeItemWithOrigin,
  type WardrobeTier,
} from '@/lib/wardrobe/wardrobe-container'
import type { WearAnnotated } from '@/lib/wardrobe/wear-display'

/** An item as a wardrobe collection read returns it. */
export type TierItem = WardrobeItemWithOrigin & WearAnnotated

export interface UseWardrobeTierOptions {
  /** Ask the server for archived items too (flagged, not hidden). */
  includeArchived?: boolean
  /** Skip the read entirely (the tier isn't needed yet). */
  enabled?: boolean
}

export interface UseWardrobeTierResult {
  /** The tier's items, or undefined until the read lands (or when it failed / is disabled). */
  items: TierItem[] | undefined
  /** True while the first read for this key is in flight. */
  loading: boolean
  /** True once a read for this key has settled, successfully or not. */
  fetched: boolean
  refetch: () => Promise<unknown>
}

export function useWardrobeTier(
  tier: WardrobeTier | null,
  opts?: UseWardrobeTierOptions,
): UseWardrobeTierResult {
  const includeArchived = opts?.includeArchived === true
  const enabled = tier !== null && opts?.enabled !== false
  const tierKey = tier ? wardrobeTierKey(tier) : 'none'
  const url = tier ? wardrobeTierUrl(tier, { includeArchived }) : ''

  // `url` is a pure function of `tierKey` + `includeArchived`, both in the key.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const query = useQuery({
    queryKey: queryKeys.wardrobe.list(tierKey, { includeArchived }),
    queryFn: async ({ signal }) => {
      const data = await apiFetch<{ wardrobeItems?: TierItem[] }>(url, { signal })
      return data?.wardrobeItems ?? []
    },
    enabled,
  })

  const error = query.error
  useEffect(() => {
    if (error) console.warn('[useWardrobeTier] Failed to load wardrobe tier', { tierKey, error })
  }, [error, tierKey])

  return {
    items: query.data,
    loading: enabled && query.isLoading,
    fetched: enabled && query.isFetched,
    refetch: query.refetch,
  }
}
