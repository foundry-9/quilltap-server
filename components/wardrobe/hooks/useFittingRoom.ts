'use client'

/**
 * The Outfit Builder's fitting room — a transient outfit composition used as
 * the avatar source, a Save-as-outfit seed, and (in chat) a Try on.
 *
 * Distinct from the chat's stored `equippedOutfit`: changes here never hit the
 * equip API until Try on. Seeded once per character from what they wear (in
 * chat) or from their defaults (out of chat). Outfits put on since the last
 * seed or reset ride beside the slots as `wornBundleIds`, so the wear ledger
 * can credit them on Try on; every wholesale replacement resets them with it.
 *
 * @module components/wardrobe/hooks/useFittingRoom
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { fetchJson } from '@/lib/fetch-helpers'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import {
  WARDROBE_SLOT_TYPES,
  cloneEquippedSlots,
  equippedSlotsEqual,
  makeEmptyEquippedSlots,
  type EquippedSlots,
  type WardrobeItem,
} from '@/lib/schemas/wardrobe.types'
import { buildDefaultOutfitWithCredit } from '@/lib/wardrobe/default-outfit'
import {
  appendWornBundleIds,
  buildSetAllEquipBody,
  type StagedGesture,
} from '@/lib/wardrobe/staged-live-outfits'

export interface UseFittingRoomOptions {
  chatId: string | null
  characterId: string | null
  /** In chat: the character's worn slots, or undefined until they arrive. */
  wornSlots: EquippedSlots | undefined
  /** The character's wearable pool (defaults are picked from it). */
  items: WardrobeItem[]
  requestConfirmation: (message: string) => Promise<boolean>
}

export interface UseFittingRoomResult {
  slots: EquippedSlots
  apply: (gesture: StagedGesture) => void
  resetToWorn: () => Promise<void>
  resetToDefaults: () => Promise<void>
  clearAll: () => Promise<void>
  /** Every distinct id in the composition, slot order — the Save-as-outfit components. */
  componentIds: () => string[]
  /** Try on: `set_all` the composition. Resolves true on success. */
  wear: () => Promise<boolean>
}

export function useFittingRoom({
  chatId,
  characterId,
  wornSlots,
  items,
  requestConfirmation,
}: UseFittingRoomOptions): UseFittingRoomResult {
  const queryClient = useQueryClient()
  const isInChat = chatId !== null
  const [slots, setSlots] = useState<EquippedSlots>(() => makeEmptyEquippedSlots())
  const [wornBundleIds, setWornBundleIds] = useState<string[]>([])
  const seedKeyRef = useRef<string | null>(null)

  // Seed once per character. In chat wait for the worn snapshot; out of chat
  // wait for the items so the defaults can be picked out.
  useEffect(() => {
    if (!characterId) return
    const worn = isInChat ? wornSlots : undefined
    if (isInChat && !worn) return
    if (items.length === 0 && !worn) return

    const seedKey = `${characterId}|${chatId ?? 'no-chat'}`
    if (seedKeyRef.current === seedKey) return
    seedKeyRef.current = seedKey

    const seed = worn
      ? { slots: cloneEquippedSlots(worn), wornBundles: [] }
      : buildDefaultOutfitWithCredit(items)
    setSlots(seed.slots)
    setWornBundleIds(seed.wornBundles.map((b) => b.id))
  }, [characterId, chatId, isInChat, wornSlots, items])

  const apply = useCallback((gesture: StagedGesture) => {
    setSlots((prev) => gesture.mutate(prev))
    if (gesture.wornBundleIds.length > 0) {
      setWornBundleIds((prev) => appendWornBundleIds(prev, gesture.wornBundleIds))
    }
  }, [])

  /** Replace the composition wholesale, asking first if it would discard work. */
  const replaceWith = useCallback(
    async (target: EquippedSlots, bundleIds: string[], question: string): Promise<void> => {
      if (!equippedSlotsEqual(slots, target) && !(await requestConfirmation(question))) return
      setSlots(target)
      setWornBundleIds(bundleIds)
    },
    [slots, requestConfirmation],
  )

  const resetToWorn = useCallback(async () => {
    if (!characterId) return
    await replaceWith(
      wornSlots ? cloneEquippedSlots(wornSlots) : makeEmptyEquippedSlots(),
      [],
      'Discard your composition and start from what’s currently worn?',
    )
  }, [characterId, wornSlots, replaceWith])

  const resetToDefaults = useCallback(async () => {
    const { slots: target, wornBundles } = buildDefaultOutfitWithCredit(items)
    await replaceWith(
      target,
      wornBundles.map((b) => b.id),
      'Discard your composition and start from this character’s default outfit?',
    )
  }, [items, replaceWith])

  const clearAll = useCallback(async () => {
    await replaceWith(makeEmptyEquippedSlots(), [], 'Empty every slot in the Outfit Builder?')
  }, [replaceWith])

  const componentIds = useCallback((): string[] => {
    const seen = new Set<string>()
    const ids: string[] = []
    for (const slot of WARDROBE_SLOT_TYPES) {
      for (const id of slots[slot]) {
        if (!seen.has(id)) {
          seen.add(id)
          ids.push(id)
        }
      }
    }
    return ids
  }, [slots])

  const wear = useCallback(async (): Promise<boolean> => {
    if (!characterId || !chatId) return false
    const result = await fetchJson<{ equippedSlots: EquippedSlots }>(
      `/api/v1/chats/${chatId}?action=equip`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSetAllEquipBody(characterId, slots, wornBundleIds)),
      },
    )
    if (!result.ok) {
      showErrorToast(result.error || 'Failed to wear this outfit')
      return false
    }
    showSuccessToast('Worn!')
    await queryClient.invalidateQueries({ queryKey: queryKeys.wardrobe.all })
    return true
  }, [characterId, chatId, slots, wornBundleIds, queryClient])

  return { slots, apply, resetToWorn, resetToDefaults, clearAll, componentIds, wear }
}
