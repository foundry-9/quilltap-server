/**
 * Shared types for the WardrobeItemEditor and its subcomponents.
 */

import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import type { WardrobeOrigin } from '@/lib/wardrobe/wardrobe-container'

/** A wardrobe item summary shape used by the components multi-select. */
export interface CandidateItem {
  id: string
  title: string
  types: WardrobeItemType[]
  componentItemIds: string[]
  /**
   * Where a borrowed candidate hangs, as its collection read reported it.
   * Null for an item that lives in the wardrobe being edited (and for one that
   * arrived without an origin) — those get no chip.
   */
  origin: WardrobeOrigin | null
}

export type CandidateGroup = WardrobeItemType | 'multi'
