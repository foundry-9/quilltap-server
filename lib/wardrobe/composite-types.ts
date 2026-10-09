/**
 * Shared helper for computing the canonical type union of a composite
 * wardrobe item from its components.
 *
 * Lifted out of the create-item handler so the editor UI and any other
 * caller can derive the same `types` array the server will compute.
 */

import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types';

/**
 * Compute the union of slot types across a list of components, in canonical
 * slot order (`top → bottom → footwear → accessories → hair`). Used to derive a
 * composite item's `types` from its components.
 */
export function unionTypes(components: readonly Pick<WardrobeItem, 'types'>[]): WardrobeItemType[] {
  const set = new Set<WardrobeItemType>();
  for (const c of components) {
    for (const t of c.types) set.add(t);
  }
  return WARDROBE_SLOT_TYPES.filter((s) => set.has(s));
}

/**
 * A composite's `types`: every slot its components cover plus any extra slots
 * it designates (a "Naked" composite that clears accessories it holds nothing
 * for). Widens, never narrows — the one rule for create and update, client and
 * server, so an edit can never silently drop a slot the composite claimed.
 */
export function buildCompositeTypes(
  components: readonly Pick<WardrobeItem, 'types'>[],
  designated: readonly WardrobeItemType[] = [],
): WardrobeItemType[] {
  const set = new Set<WardrobeItemType>([...unionTypes(components), ...designated]);
  return WARDROBE_SLOT_TYPES.filter((s) => set.has(s));
}
