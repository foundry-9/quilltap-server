'use client'

/**
 * The wardrobe a Workbench vantage looks at.
 *
 * A thin switch over the two loaders the wardrobe dialog already uses: a
 * character vantage reads `useCharacterWardrobeItems` (the character's own
 * vault, their groups', and Quilltap General — no project tier, because the
 * Workbench has no chat, exactly as `loadToolPool` resolves a run in a chat
 * with no project); a container vantage reads `useWardrobeContainerItems`.
 * Archived items are always included, flagged, so a reference to a retired
 * garment still resolves and can say so.
 *
 * Both loaders key through `queryKeys.wardrobe.list`, so this adds no query
 * key, no route and no polling site.
 *
 * Design of record: docs/developer/features/complete/pascal-wardrobe-effect-picker.md §3.5
 *
 * @module lib/hooks/use-wardrobe-vantage-items
 */

import { useCharacterWardrobeItems } from '@/lib/hooks/use-character-wardrobe-items'
import { useWardrobeContainerItems } from '@/lib/hooks/use-wardrobe-container-items'
import type { TierItem } from '@/lib/hooks/use-wardrobe-tier'
import type { WardrobeVantage } from '@/lib/pascal/tool-draft'

export interface UseWardrobeVantageItemsResult {
  /** What the vantage can reach, nearest tier first — the pool a reference resolves against. */
  items: TierItem[]
  /** `items` plus anything a composite's components may name (General archetypes for a shared container). */
  resolutionItems: TierItem[]
  loading: boolean
  /** True once the reads have settled; false for the `none` vantage. */
  fetched: boolean
}

const EMPTY: TierItem[] = []

/** Load the vantage's wardrobe. `null` (or the `none` vantage) reads nothing. */
export function useWardrobeVantageItems(vantage: WardrobeVantage | null): UseWardrobeVantageItemsResult {
  const characterId = vantage?.kind === 'character' ? vantage.characterId : null
  const container = vantage?.kind === 'container' ? vantage.container : null

  const character = useCharacterWardrobeItems(characterId, { includeArchived: true })
  const shared = useWardrobeContainerItems(container, { includeArchived: true })

  if (characterId) {
    return { items: character.items, resolutionItems: character.items, loading: character.loading, fetched: character.fetched }
  }
  if (container) {
    return { items: shared.items, resolutionItems: shared.resolutionItems, loading: shared.loading, fetched: shared.fetched }
  }
  return { items: EMPTY, resolutionItems: EMPTY, loading: false, fetched: false }
}
