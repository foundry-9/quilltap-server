'use client'

/**
 * Unified character wardrobe loader.
 *
 * A character's wearable garments across every wardrobe tier, as N tier
 * queries (`useWardrobeTier`) merged by the server's rule
 * (`mergeWearableTiers`, `lib/wardrobe/wearable-pool.ts`):
 *   1. the character's personal vault items
 *   2. the shared wardrobe of every group the character belongs to
 *   3. the active project's shared wardrobe (when a `projectId`/`chatId` is given)
 *   4. the Quilltap General shared library
 *
 * Precedence is **character > group > project > general**. Without
 * `includeArchived`, archived items leave each tier before the shadowing, so
 * an archived personal copy never hides a live shared item with the same id.
 * With it, the full per-tier lists are shadowed as they stand
 * (`mergeWardrobeTiers`).
 *
 * Used by the wardrobe dialog's character view, the chat-start outfit
 * composer (`OutfitSelector`), and the item editor's component candidates.
 *
 * @module lib/hooks/use-character-wardrobe-items
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/query/fetcher'
import { GENERAL_CONTAINER, mergeWardrobeTiers } from '@/lib/wardrobe/wardrobe-container'
import { mergeWearableTiers } from '@/lib/wardrobe/wearable-pool'
import { useWardrobeTier, type TierItem } from '@/lib/hooks/use-wardrobe-tier'

export interface UseCharacterWardrobeItemsResult {
  /**
   * The merged pool. Each item carries the `origin` its endpoint attached;
   * the winning tier's copy (and origin) is the one kept.
   */
  items: TierItem[]
  /** True while any needed tier is on its first read. */
  loading: boolean
  /**
   * True once every needed tier has settled for the current character — even
   * when they resolved to nothing. Lets callers tell "no items yet because we
   * haven't looked" apart from "looked, found none".
   */
  fetched: boolean
  /**
   * The project tier this loader resolved (from an explicit `projectId` or
   * derived from `chatId`), or null when there is none.
   */
  projectId: string | null
}

export interface UseCharacterWardrobeItemsOptions {
  /** Project whose shared wardrobe should be folded in (the project tier). */
  projectId?: string | null
  /** Chat to derive the project tier from when `projectId` isn't known directly. */
  chatId?: string | null
  /**
   * Fold archived garments into the result, flagged rather than hidden. Every
   * tier honours it. Default false.
   */
  includeArchived?: boolean
}

const EMPTY: TierItem[] = []

/**
 * The project a chat belongs to — the one field the wardrobe needs from it.
 * Null while unknown or when the chat has no project.
 */
export function useChatProjectId(chatId: string | null | undefined, enabled = true): {
  projectId: string | null
  settled: boolean
} {
  const active = Boolean(chatId) && enabled
  const query = useQuery({
    queryKey: queryKeys.chats.project(chatId ?? 'none'),
    queryFn: async ({ signal }) => {
      const data = await apiFetch<{ chat?: { projectId?: string | null } }>(
        `/api/v1/chats/${chatId}`,
        { signal },
      )
      return data?.chat?.projectId ?? null
    },
    enabled: active,
    staleTime: Infinity,
  })
  return { projectId: query.data ?? null, settled: !active || query.isFetched }
}

export function useCharacterWardrobeItems(
  characterId: string | null | undefined,
  opts?: UseCharacterWardrobeItemsOptions,
): UseCharacterWardrobeItemsResult {
  const explicitProjectId = opts?.projectId ?? null
  const includeArchived = opts?.includeArchived === true
  const active = Boolean(characterId)

  // Resolve the project tier: an explicit projectId wins; otherwise derive it
  // from the chat (the dialog only carries a chat id).
  const chatProject = useChatProjectId(opts?.chatId ?? null, active && !explicitProjectId)
  const projectId = explicitProjectId ?? chatProject.projectId

  const tierOpts = { includeArchived, enabled: active }
  const character = characterId ? { scope: 'character' as const, id: characterId } : null
  const personal = useWardrobeTier(character ? { container: character } : null, tierOpts)
  const groups = useWardrobeTier(character ? { container: character, groups: true } : null, tierOpts)
  const project = useWardrobeTier(
    projectId ? { container: { scope: 'project', id: projectId } } : null,
    tierOpts,
  )
  const general = useWardrobeTier({ container: GENERAL_CONTAINER }, tierOpts)

  const items = useMemo(() => {
    if (!active) return EMPTY
    // The wearable view is the server's own rule (archived dropped per tier,
    // then shadowed); "Show archived" shadows the full per-tier lists.
    if (!includeArchived) {
      return mergeWearableTiers([
        general.items ?? EMPTY,
        project.items ?? EMPTY,
        groups.items ?? EMPTY,
        personal.items ?? EMPTY,
      ])
    }
    return mergeWardrobeTiers([personal.items, groups.items, project.items, general.items], {
      includeArchived: true,
    })
  },
    [active, personal.items, groups.items, project.items, general.items, includeArchived],
  )

  const tiers = [personal, groups, general, ...(projectId ? [project] : [])]
  const loading = active && tiers.some((t) => t.loading)
  const fetched = active && chatProject.settled && tiers.every((t) => t.fetched)

  return { items, loading, fetched, projectId }
}
