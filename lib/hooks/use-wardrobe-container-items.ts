'use client'

/**
 * Shared-container wardrobe loader.
 *
 * Loads the items of one *shared* wardrobe container — Quilltap General, a
 * project's store, or a group's store — without any tier merging: the list is
 * exactly what lives in that container's `Wardrobe/` folder, which is what the
 * wardrobe browser shows (and lets you edit) on that container. The character
 * scope stays with `useCharacterWardrobeItems`, whose job is the opposite.
 *
 * Alongside the container's own list, the General library is read as a
 * *resolution pool* (`resolutionItems`) so composite rows can display
 * components that bundle a General archetype. That read always includes
 * archived items: a composite may bundle one, and an unresolvable component
 * renders as a gap.
 *
 * Both reads are `useWardrobeTier` queries, so they share the cache (and the
 * `queryKeys.wardrobe.all` invalidation) with every other wardrobe list.
 *
 * @module lib/hooks/use-wardrobe-container-items
 */

import { useMemo } from 'react'
import {
  GENERAL_CONTAINER,
  mergeWardrobeTiers,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'
import { useWardrobeTier, type TierItem } from '@/lib/hooks/use-wardrobe-tier'

export interface UseWardrobeContainerItemsResult {
  /** Items that live in the container itself — the editable set. */
  items: TierItem[]
  /** `items` plus General archetypes (each with its own origin), for resolving composite components. */
  resolutionItems: TierItem[]
  loading: boolean
  /** True once the container's reads have settled for the current container. */
  fetched: boolean
}

const EMPTY: TierItem[] = []

/**
 * Load a shared container's wardrobe. Pass null (or a character-scoped
 * container) to no-op.
 */
export function useWardrobeContainerItems(
  container: WardrobeContainer | null,
  opts?: {
    /** Fold archived garments into `items`, flagged rather than hidden. */
    includeArchived?: boolean
  },
): UseWardrobeContainerItemsResult {
  const active = container !== null && container.scope !== 'character'
  const isGeneral = container?.scope === 'general'
  const includeArchived = opts?.includeArchived === true

  const own = useWardrobeTier(active ? { container } : null, { includeArchived })
  const general = useWardrobeTier(
    { container: GENERAL_CONTAINER },
    { includeArchived: true, enabled: active && !isGeneral },
  )

  const items = active ? (own.items ?? EMPTY) : EMPTY
  const resolutionItems = useMemo(
    () =>
      active
        ? mergeWardrobeTiers([own.items, isGeneral ? undefined : general.items], {
            includeArchived: true,
          })
        : EMPTY,
    [active, own.items, isGeneral, general.items],
  )

  // Settled once the container's read has landed and, unless General IS the
  // container, the resolution pool's read too (each may have failed).
  const fetched = own.fetched && (isGeneral || general.fetched)
  return { items, resolutionItems, loading: own.loading, fetched }
}
