'use client'

/**
 * useChatOutfit — what every character in one chat is wearing.
 *
 * A TanStack Query read of `GET /api/v1/chats/[id]?action=outfit`
 * (`{ equippedOutfit: { [characterId]: EquippedSlots } }`), keyed
 * `queryKeys.wardrobe.outfit(chatId)` so the `wardrobe.all` invalidation that
 * follows every equip refreshes it. Pass `chatId === null` for chat-less
 * surfaces; the query stays idle.
 *
 * The snapshot seeds staging that never re-seeds (the Live tab and the Outfit
 * Builder are ref-gated so a refetch can't wipe in-progress edits), so a
 * cached copy from an earlier visit must never reach them: an LLM may have
 * dressed or undressed someone since (bug 198). The query therefore refetches
 * on every mount, and `slotsFor` answers undefined until that fetch lands.
 *
 * Equipping is not here: the wardrobe dialog stages its gestures and commits
 * with `?action=equip` (`set_all`) on Done.
 *
 * @module lib/hooks/use-outfit
 */

import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/query/fetcher'
import { EMPTY_EQUIPPED_SLOTS, type EquippedOutfitState, type EquippedSlots } from '@/lib/schemas/wardrobe.types'

export interface UseChatOutfitResult {
  /** The chat's equipped outfit per character, or undefined until it arrives. */
  equippedOutfit: EquippedOutfitState | undefined
  /**
   * One character's worn slots — empty slots for a character the chat has
   * never dressed — or undefined until a snapshot fetched since this view
   * mounted has arrived. A cached copy from an earlier visit never answers.
   */
  slotsFor: (characterId: string | null) => EquippedSlots | undefined
  loading: boolean
  refetch: () => Promise<unknown>
}

export function useChatOutfit(chatId: string | null): UseChatOutfitResult {
  const query = useQuery({
    queryKey: queryKeys.wardrobe.outfit(chatId ?? 'none'),
    queryFn: async ({ signal }) => {
      const data = await apiFetch<{ equippedOutfit?: EquippedOutfitState }>(
        `/api/v1/chats/${chatId}?action=outfit`,
        { signal, cache: 'no-store' },
      )
      return data?.equippedOutfit ?? {}
    },
    enabled: chatId !== null,
    refetchOnMount: 'always',
  })

  const equippedOutfit = query.data
  const current = query.isFetchedAfterMount
  const slotsFor = useCallback(
    (characterId: string | null): EquippedSlots | undefined => {
      if (!characterId || !equippedOutfit || !current) return undefined
      return equippedOutfit[characterId] ?? EMPTY_EQUIPPED_SLOTS
    },
    [equippedOutfit, current],
  )

  return {
    equippedOutfit,
    slotsFor,
    loading: chatId !== null && query.isLoading,
    refetch: query.refetch,
  }
}
