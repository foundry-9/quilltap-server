'use client'

/**
 * What a wardrobe browser lists for one container, and who may manage what.
 *
 *  - A character container lists the character's merged pool
 *    (`useCharacterWardrobeItems`: own vault > groups > project > General).
 *    Only the character's own garments are manageable there; the rest are
 *    borrowed (Move / Copy only, with an origin chip).
 *  - A shared container (General, a project, a group) lists exactly its own
 *    `Wardrobe/` folder, every row manageable; General archetypes join the
 *    resolution pool so a composite row can show its components.
 *
 * @module components/wardrobe/hooks/useWardrobeListData
 */

import { useCallback, useMemo } from 'react'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'
import { useCharacterWardrobeItems } from '@/lib/hooks/use-character-wardrobe-items'
import { useWardrobeContainerItems } from '@/lib/hooks/use-wardrobe-container-items'
import type { TierItem } from '@/lib/hooks/use-wardrobe-tier'

export interface WardrobeListData {
  /** The rows to list. */
  listItems: TierItem[]
  /** Everything a composite row may resolve its components against. */
  resolutionPool: TierItem[]
  /** The character's wearable pool (character container only; empty otherwise). */
  characterItems: TierItem[]
  loading: boolean
  /** The project tier folded into a character's pool, if any. */
  projectId: string | null
  /** May this view edit / star / duplicate / delete the item? */
  canManage: (item: WardrobeItem) => boolean
}

const EMPTY: TierItem[] = []

export function useWardrobeListData(
  container: WardrobeContainer | null,
  opts: { chatId?: string | null; includeArchived: boolean },
): WardrobeListData {
  const isCharacterScope = container?.scope === 'character'
  const character = useCharacterWardrobeItems(isCharacterScope ? container.id : null, {
    chatId: opts.chatId ?? null,
    includeArchived: opts.includeArchived,
  })
  const shared = useWardrobeContainerItems(isCharacterScope ? null : container, {
    includeArchived: opts.includeArchived,
  })

  const sharedIds = useMemo(() => new Set(shared.items.map((i) => i.id)), [shared.items])
  const canManage = useCallback(
    (item: WardrobeItem): boolean =>
      isCharacterScope ? Boolean(item.characterId) : sharedIds.has(item.id),
    [isCharacterScope, sharedIds],
  )

  return isCharacterScope
    ? {
        listItems: character.items,
        resolutionPool: character.items,
        characterItems: character.items,
        loading: character.loading,
        projectId: character.projectId,
        canManage,
      }
    : {
        listItems: shared.items,
        resolutionPool: shared.resolutionItems,
        characterItems: EMPTY,
        loading: shared.loading,
        projectId: null,
        canManage,
      }
}
