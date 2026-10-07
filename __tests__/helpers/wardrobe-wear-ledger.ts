/**
 * Test double for `repos.wardrobeWear` that forwards the equip chokepoint's
 * slot write to a mocked `chats.setEquippedOutfit`, so tests written against
 * the slot write keep asserting on it. Records every chokepoint call for
 * tests that care about `source` / `wornBundles`.
 */

import type {
  CommitEquippedOutfitInput,
  CommitEquippedOutfitResult,
} from '@/lib/database/repositories/wardrobe-wear.repository'
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types'

export function ledgerOver(chats: {
  setEquippedOutfit: (chatId: string, characterId: string, slots: EquippedSlots) => unknown
}) {
  return {
    commitEquippedOutfit: jest.fn(async (input: CommitEquippedOutfitInput): Promise<CommitEquippedOutfitResult> => {
      await chats.setEquippedOutfit(input.chatId, input.characterId, input.nextSlots)
      return { slots: input.nextSlots, newlyWornLeafIds: [], creditedBundleIds: [], changed: true }
    }),
  }
}
