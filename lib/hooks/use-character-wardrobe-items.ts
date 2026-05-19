'use client'

/**
 * Unified character wardrobe loader.
 *
 * Loads a character's personal wardrobe items plus the shared archetype
 * library and merges them (de-duped by id, personal items winning when
 * there's a collision). Used by:
 *  - The global wardrobe dialog (`WardrobeControlDialogInner`)
 *  - The chat-start outfit composer (`OutfitSelector`'s `manual` mode)
 *
 * @module lib/hooks/use-character-wardrobe-items
 */

import { useCallback, useEffect, useState } from 'react'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

export interface UseCharacterWardrobeItemsResult {
  items: WardrobeItem[]
  loading: boolean
  /** Re-fetch personal + archetype items. */
  reload: () => Promise<void>
}

export function useCharacterWardrobeItems(
  characterId: string | null | undefined,
): UseCharacterWardrobeItemsResult {
  const [items, setItems] = useState<WardrobeItem[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    if (!characterId) {
      setItems([])
      return
    }
    setLoading(true)
    try {
      const [personalRes, archetypeRes] = await Promise.all([
        fetch(`/api/v1/characters/${characterId}/wardrobe`),
        fetch('/api/v1/wardrobe'),
      ])
      const collected: WardrobeItem[] = []
      if (personalRes.ok) {
        const data = (await personalRes.json()) as { wardrobeItems?: WardrobeItem[] }
        for (const w of data.wardrobeItems ?? []) collected.push(w)
      }
      if (archetypeRes.ok) {
        const data = (await archetypeRes.json()) as { wardrobeItems?: WardrobeItem[] }
        for (const w of data.wardrobeItems ?? []) {
          if (!collected.some((c) => c.id === w.id)) collected.push(w)
        }
      }
      setItems(collected)
    } catch (err) {
      console.warn('[useCharacterWardrobeItems] Failed to load wardrobe', err)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [characterId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload wraps an async fetch; the setState lands well after this effect tick
    void reload()
  }, [reload])

  return { items, loading, reload }
}
