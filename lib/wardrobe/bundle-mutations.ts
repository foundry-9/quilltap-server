/**
 * Pure helpers for the legacy whole-composite-id path: an outfit worn before
 * 4.8.1 still sits in equipped state as its own id and renders as a card
 * (`group-equipped.ts`). These are its two actions — take it off, break it
 * apart. Anything worn since dissolves as it goes on and never reaches here.
 * Shared by the wardrobe dialog's Live and Builder tabs and the chat-start
 * outfit composer.
 *
 * @module lib/wardrobe/bundle-mutations
 */

import type { EquippedSlots, WardrobeItem } from '@/lib/schemas/wardrobe.types'
import { removeIdFromSlot } from '@/lib/schemas/wardrobe.types'
import type { EquippedBundle } from '@/lib/wardrobe/group-equipped'
import { dissolveCompositesInSlots } from '@/lib/wardrobe/slot-ops'

/** Remove a bundle's composite id from every slot it occupies. */
export function takeOffBundleFromSlots(
  slots: EquippedSlots,
  bundle: EquippedBundle,
): EquippedSlots {
  let next = slots
  for (const slot of bundle.occupiedSlots) {
    next = removeIdFromSlot(next, slot, bundle.compositeId)
  }
  return next
}

/**
 * Dissolve one worn composite into its leaves, in place — transitively, exactly
 * as wearing it today would (`dissolveCompositesInSlots`). A composite whose
 * parts can't be resolved is left as it is.
 */
export function breakApartBundleInSlots(
  slots: EquippedSlots,
  bundle: EquippedBundle,
  itemsById: ReadonlyMap<string, WardrobeItem>,
): EquippedSlots {
  return dissolveCompositesInSlots(slots, itemsById, new Set([bundle.compositeId])).slots
}
