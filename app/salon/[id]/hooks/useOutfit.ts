'use client'

/**
 * Salon-scoped re-export of the portable `useOutfit` hook.
 *
 * The hook itself lives at `lib/hooks/use-outfit.ts` so non-Salon surfaces
 * (the wardrobe control dialog, etc.) can import it without coupling to the
 * Salon route. Existing imports through the Salon path keep working.
 */

export {
  useOutfit,
} from '@/lib/hooks/use-outfit'
export type {
  WardrobeItemSummary,
  ResolvedSlotItems,
  CharacterOutfitState,
  OutfitState,
  WardrobeCache,
} from '@/lib/hooks/use-outfit'
