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
import type { EquippedSlots, WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import { computeDisplacedSlots } from '@/lib/wardrobe/outfit-displacement'

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

export function useOutfit(chatId: string, characterIds: string[] = []) {
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
      // Fetch personal wardrobe and shared archetypes in parallel
      const [personalRes, archetypeRes] = await Promise.all([
        fetch(`/api/v1/characters/${characterId}/wardrobe`),
        fetch('/api/v1/wardrobe'),
      ])

      const personalItems: WardrobeItemSummary[] = []
      if (personalRes.ok) {
        const data = await personalRes.json()
        for (const item of (data.wardrobeItems || [])) {
          personalItems.push({ id: item.id, title: item.title, types: item.types, isDefault: item.isDefault })
        }
      } else {
        console.warn('[useOutfit] Failed to fetch wardrobe for character', characterId, personalRes.status)
      }

      if (archetypeRes.ok) {
        const data = await archetypeRes.json()
        for (const item of (data.wardrobeItems || [])) {
          // Avoid duplicates (shouldn't happen, but safety check)
          if (!personalItems.some(p => p.id === item.id)) {
            personalItems.push({ id: item.id, title: `${item.title} (shared)`, types: item.types, isDefault: false })
          }
        }
      }

      fetchedWardrobesRef.current.add(characterId)
      setWardrobeCache(prev => ({ ...prev, [characterId]: personalItems }))
      return personalItems
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
   * Returns the new outfit state, or null on failure.
   */
  const refreshOutfit = useCallback(async (): Promise<OutfitState | null> => {
    if (!chatId) return null

    setLoading(true)
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=outfit`)
      if (!res.ok) {
        console.warn('[useOutfit] Failed to fetch outfit state', res.status)
        return null
      }

      const data = await res.json()
      const equippedOutfit: Record<string, EquippedSlots> = data.equippedOutfit || {}

      // Merge character IDs from equipped outfit with all known character IDs
      const allCharacterIds = new Set([
        ...Object.keys(equippedOutfit),
        ...characterIds,
      ])
      const newOutfitState: OutfitState = {}

      const emptySlots: EquippedSlots = { top: null, bottom: null, footwear: null, accessories: null }

      await Promise.all(
        Array.from(allCharacterIds).map(async (characterId) => {
          const slots = equippedOutfit[characterId] ?? emptySlots
          const wardrobeItems = await fetchWardrobeForCharacter(characterId)
          // Only include characters that actually have wardrobe items
          if (wardrobeItems.length > 0 || equippedOutfit[characterId]) {
            const items = resolveItemDetails(slots, wardrobeItems)
            newOutfitState[characterId] = { slots, items }
          }
        })
      )

      setOutfitState(newOutfitState)
      return newOutfitState
    } catch (err) {
      console.error('[useOutfit] Error refreshing outfit state', { chatId, error: err })
      return null
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- characterIds identity changes; content is stable after chat load
  }, [chatId, characterIds.join(','), fetchWardrobeForCharacter, resolveItemDetails])

  /**
   * Equip or unequip an item in a specific slot for a character.
   * Returns the resolved item details for the new outfit, or null on failure.
   */
  const equipSlot = useCallback(async (
    characterId: string,
    slot: string,
    itemId: string | null
  ): Promise<Record<string, { title: string } | null> | null> => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=equip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId, slot, itemId }),
      })

      if (!res.ok) {
        console.error('[useOutfit] Failed to equip slot', { characterId, slot, itemId, status: res.status })
        return null
      }

      // Optimistic update with multi-type displacement
      const items = wardrobeCache[characterId] ?? []
      const currentChar = outfitState[characterId]
      if (!currentChar) return null

      const newSlots = computeDisplacedSlots(
        currentChar.slots,
        items,
        slot as WardrobeItemType,
        itemId
      )
      const newItems = resolveItemDetails(newSlots, items)

      setOutfitState(prev => ({
        ...prev,
        [characterId]: { slots: newSlots, items: newItems },
      }))

      return newItems
    } catch (err) {
      console.error('[useOutfit] Error equipping slot', { characterId, slot, itemId, error: err })
      return null
    }
  }, [chatId, wardrobeCache, outfitState, resolveItemDetails])

  /**
   * Invalidate the wardrobe cache for a specific character (or all characters).
   * Call this before refreshOutfit when items have been added/removed externally
   * (e.g., via the gift modal or character wardrobe page).
   */
  const invalidateWardrobe = useCallback((characterId?: string) => {
    if (characterId) {
      fetchedWardrobesRef.current.delete(characterId)
    } else {
      fetchedWardrobesRef.current.clear()
    }
  }, [])

  // Fetch outfit state on mount
  useEffect(() => {
    refreshOutfit()
  }, [refreshOutfit])

  return {
    outfitState,
    wardrobeCache,
    loading,
    refreshOutfit,
    invalidateWardrobe,
    equipSlot,
  }
}
