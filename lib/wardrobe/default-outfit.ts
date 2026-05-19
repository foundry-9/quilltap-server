/**
 * Build a per-slot equipped snapshot from the items marked `isDefault: true`.
 *
 * Used both by the wardrobe dialog (to seed the Outfit Builder when there's
 * no chat context) and by the chat-start outfit composer (when the user
 * picks `Compose outfit`).
 *
 * @module lib/wardrobe/default-outfit
 */

import type { EquippedSlots, WardrobeItem } from '@/lib/schemas/wardrobe.types'

export function buildDefaultOutfit(items: WardrobeItem[]): EquippedSlots {
  const next: EquippedSlots = { top: [], bottom: [], footwear: [], accessories: [] }
  for (const item of items) {
    if (!item.isDefault || item.archivedAt) continue
    for (const slot of item.types) next[slot].push(item.id)
  }
  return next
}
