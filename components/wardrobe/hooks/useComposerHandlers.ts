'use client'

/**
 * The six slot handlers an `OutfitComposer` takes, built once from the pure
 * gestures in `lib/wardrobe/staged-live-outfits.ts`. Every staging surface —
 * the wardrobe dialog's Live tab and Outfit Builder, and the chat-start
 * composer — passes its own `apply` (where a gesture lands) and shares the
 * rest, so wearing, layering, removing and the legacy bundle actions behave
 * the same everywhere.
 *
 * @module components/wardrobe/hooks/useComposerHandlers
 */

import { useMemo } from 'react'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import type { EquippedBundle } from '@/lib/wardrobe/group-equipped'
import {
  breakApartBundleGesture,
  clearSlotGesture,
  removeFromSlotGesture,
  takeOffBundleGesture,
  wearGesture,
  type StagedGesture,
} from '@/lib/wardrobe/staged-live-outfits'

export interface ComposerHandlers {
  onAddToSlot: (slot: WardrobeItemType, itemId: string) => void
  onRemoveFromSlot: (slot: WardrobeItemType, itemId: string) => void
  onClearSlot: (slot: WardrobeItemType) => void
  onTakeOffBundle: (bundle: EquippedBundle) => void
  onBreakApartBundle: (bundle: EquippedBundle) => void
}

export interface UseComposerHandlersOptions {
  itemsById: ReadonlyMap<string, WardrobeItem>
  /** Land a gesture on this surface's slots (and its worn-bundle claims). */
  apply: (gesture: StagedGesture) => void
  /**
   * Refuse to put an item on (e.g. an archived one). Return true to refuse;
   * the guard says why itself.
   */
  refuse?: (item: WardrobeItem) => boolean
}

export function useComposerHandlers({
  itemsById,
  apply,
  refuse,
}: UseComposerHandlersOptions): ComposerHandlers {
  return useMemo<ComposerHandlers>(
    () => ({
      // Picking an item wears it across every slot it covers (layering or
      // replacing per its flag) rather than dropping it into the one row the
      // picker was opened from. The outfit pull-down arrives here too.
      onAddToSlot: (slot, itemId) => {
        const item = itemsById.get(itemId)
        if (item && refuse?.(item)) return
        apply(wearGesture(slot, itemId, itemsById))
      },
      onRemoveFromSlot: (slot, itemId) => apply(removeFromSlotGesture(slot, itemId)),
      onClearSlot: (slot) => apply(clearSlotGesture(slot)),
      onTakeOffBundle: (bundle) => apply(takeOffBundleGesture(bundle)),
      onBreakApartBundle: (bundle) => apply(breakApartBundleGesture(bundle, itemsById)),
    }),
    [itemsById, apply, refuse],
  )
}
