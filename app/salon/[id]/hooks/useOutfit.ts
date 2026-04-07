'use client'

/**
 * useOutfit Hook
 *
 * Manages outfit state for characters in a chat session.
 * Fetches equipped outfit slots from the server, resolves item details
 * from each character's wardrobe, and provides equip/unequip actions.
 *
 * @module salon/hooks/useOutfit
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { EquippedSlots, WardrobeItem } from '@/lib/schemas/wardrobe.types'
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'

// ============================================================================
// TYPES
// ============================================================================

/** Summary of a wardrobe item (title + slot coverage) for display */
export interface WardrobeItemSummary {
  id: string
  title: string
  types: string[]
  isDefault: boolean
}

/** Per-character outfit state including equipped slots and resolved item details */
export interface CharacterOutfitState {
  slots: EquippedSlots
  /** Resolved item details keyed by slot name */
  items: Record<string, { title: string } | null>
}

/** Full outfit state for the hook, keyed by character ID */
export type OutfitState = Record<string, CharacterOutfitState>

/** Per-character wardrobe items cache, keyed by character ID */
export type WardrobeCache = Record<string, WardrobeItemSummary[]>

// ============================================================================
// HOOK
// ============================================================================

export function useOutfit(chatId: string) {
  const [outfitState, setOutfitState] = useState<OutfitState>({})
  const [wardrobeCache, setWardrobeCache] = useState<WardrobeCache>({})
  const [loading, setLoading] = useState(false)

  // Track which character wardrobes we've already fetched
  const fetchedWardrobesRef = useRef<Set<string>>(new Set())

  /**
   * Fetch wardrobe items for a single character and cache them.
   */
  const fetchWardrobeForCharacter = useCallback(async (characterId: string): Promise<WardrobeItemSummary[]> => {
    if (fetchedWardrobesRef.current.has(characterId)) {
      return wardrobeCache[characterId] ?? []
    }

    try {
      const res = await fetch(`/api/v1/characters/${characterId}/wardrobe`)
      if (!res.ok) {
        console.warn('[useOutfit] Failed to fetch wardrobe for character', characterId, res.status)
        return []
      }
      const data = await res.json()
      const items: WardrobeItemSummary[] = (data.wardrobeItems || []).map((item: WardrobeItem) => ({
        id: item.id,
        title: item.title,
        types: item.types,
        isDefault: item.isDefault,
      }))

      fetchedWardrobesRef.current.add(characterId)
      setWardrobeCache(prev => ({ ...prev, [characterId]: items }))
      return items
    } catch (err) {
      console.error('[useOutfit] Error fetching wardrobe', { characterId, error: err })
      return []
    }
  }, [wardrobeCache])

  /**
   * Resolve item titles for equipped slots using the wardrobe cache.
   */
  const resolveItemDetails = useCallback((
    slots: EquippedSlots,
    items: WardrobeItemSummary[]
  ): Record<string, { title: string } | null> => {
    const result: Record<string, { title: string } | null> = {}
    for (const slot of WARDROBE_SLOT_TYPES) {
      const itemId = slots[slot]
      if (itemId) {
        const found = items.find(i => i.id === itemId)
        result[slot] = found ? { title: found.title } : null
      } else {
        result[slot] = null
      }
    }
    return result
  }, [])

  /**
   * Fetch the full equipped outfit state for this chat and resolve item details.
   */
  const refreshOutfit = useCallback(async () => {
    if (!chatId) return

    setLoading(true)
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=outfit`)
      if (!res.ok) {
        console.warn('[useOutfit] Failed to fetch outfit state', res.status)
        return
      }

      const data = await res.json()
      const equippedOutfit: Record<string, EquippedSlots> = data.equippedOutfit || {}

      // Fetch wardrobe items for each character and resolve details
      const characterIds = Object.keys(equippedOutfit)
      const newOutfitState: OutfitState = {}

      await Promise.all(
        characterIds.map(async (characterId) => {
          const slots = equippedOutfit[characterId]
          const wardrobeItems = await fetchWardrobeForCharacter(characterId)
          const items = resolveItemDetails(slots, wardrobeItems)
          newOutfitState[characterId] = { slots, items }
        })
      )

      setOutfitState(newOutfitState)
    } catch (err) {
      console.error('[useOutfit] Error refreshing outfit state', { chatId, error: err })
    } finally {
      setLoading(false)
    }
  }, [chatId, fetchWardrobeForCharacter, resolveItemDetails])

  /**
   * Equip or unequip an item in a specific slot for a character.
   */
  const equipSlot = useCallback(async (
    characterId: string,
    slot: string,
    itemId: string | null
  ) => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=equip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId, slot, itemId }),
      })

      if (!res.ok) {
        console.error('[useOutfit] Failed to equip slot', { characterId, slot, itemId, status: res.status })
        return
      }

      // Optimistic update: apply the change locally before full refresh
      const wardrobeItems = wardrobeCache[characterId] ?? []
      setOutfitState(prev => {
        const currentChar = prev[characterId]
        if (!currentChar) return prev

        const newSlots = { ...currentChar.slots, [slot]: itemId }
        const newItems = resolveItemDetails(newSlots as EquippedSlots, wardrobeItems)
        return {
          ...prev,
          [characterId]: { slots: newSlots as EquippedSlots, items: newItems },
        }
      })
    } catch (err) {
      console.error('[useOutfit] Error equipping slot', { characterId, slot, itemId, error: err })
    }
  }, [chatId, wardrobeCache, resolveItemDetails])

  // Fetch outfit state on mount
  useEffect(() => {
    refreshOutfit()
  }, [refreshOutfit])

  return {
    outfitState,
    wardrobeCache,
    loading,
    refreshOutfit,
    equipSlot,
  }
}
