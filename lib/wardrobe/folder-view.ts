/**
 * The one folder-browser rule that is the wardrobe's own — which tier a
 * listed garment sits in. The generic rules are `lib/folder-browser/view`.
 *
 * Client-safe: pure.
 *
 * @module lib/wardrobe/folder-view
 */

import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import {
  containerForListedItem,
  encodeWardrobeContainer,
  type WardrobeOrigin,
} from '@/lib/wardrobe/wardrobe-container'
import { OWN_TIER } from '@/lib/folder-browser/view'


type ViewItem = Pick<WardrobeItem, 'id' | 'characterId' | 'archivedAt'> & {
  folder?: string | null
  origin?: WardrobeOrigin | null
}

/**
 * The tier an item sits in from a view: `own` for a manageable item (or any
 * item outside a character's merged view), otherwise the wardrobe it was
 * borrowed from.
 */
export function viewTierOf(item: ViewItem, manageable: boolean, characterView: boolean): string {
  if (!characterView || manageable) return OWN_TIER
  return encodeWardrobeContainer(containerForListedItem(item))
}
