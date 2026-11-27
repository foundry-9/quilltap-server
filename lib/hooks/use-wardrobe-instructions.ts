'use client'

/**
 * Per-container dressing-instructions loader/saver.
 *
 * Loads (and saves) the optional `Wardrobe/instructions.md` of one wardrobe
 * container — a character's vault, Quilltap General, a project's store, or a
 * group's store — via that container's `?action=instructions` endpoint. No
 * tier merging here: the editor shows each container exactly its own file;
 * the character > group > project > general cascade is applied server-side
 * only when a character dresses themselves.
 *
 * One query per container (`queryKeys.wardrobe.instructions`); a save writes
 * the server's answer into that entry.
 *
 * @module lib/hooks/use-wardrobe-instructions
 */

import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import {
  encodeWardrobeContainer,
  wardrobeCollectionUrl,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'

export interface UseWardrobeInstructionsResult {
  /** The container's own instructions, or null when absent. */
  instructions: string | null
  loading: boolean
  /** True once at least one fetch has completed for the current container. */
  fetched: boolean
  saving: boolean
  /** Write (non-blank) or clear (null/blank) the file. Resolves true on success. */
  save: (value: string | null) => Promise<boolean>
}

function instructionsUrl(container: WardrobeContainer): string {
  return `${wardrobeCollectionUrl(container)}?action=instructions`
}

export function useWardrobeInstructions(
  container: WardrobeContainer | null,
): UseWardrobeInstructionsResult {
  const queryClient = useQueryClient()
  const scope = container?.scope ?? null
  const containerId = container?.id ?? null
  const containerKey = scope ? encodeWardrobeContainer({ scope, id: containerId }) : ''
  const queryKey = queryKeys.wardrobe.instructions(containerKey)
  const [saving, setSaving] = useState(false)

  // `scope` and `containerId` are what `containerKey` encodes.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- the URL is a pure function of containerKey, which is in the key
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<string | null> => {
      // An unreachable store settles to "no instructions" rather than an
      // error, so the editor still opens on it.
      try {
        const data = await apiFetch<{ instructions?: string | null }>(
          instructionsUrl({ scope: scope!, id: containerId }),
          { signal },
        )
        return data.instructions ?? null
      } catch (err) {
        console.warn('[useWardrobeInstructions] Failed to load dressing instructions', err)
        return null
      }
    },
    enabled: !!scope,
    // Read on each mount and each change of container, as before, and at no
    // other time (the key is outside `wardrobe.all`).
    staleTime: 0,
  })

  const save = useCallback(
    async (value: string | null): Promise<boolean> => {
      if (!scope) return false
      setSaving(true)
      try {
        const data = await apiFetch<{ instructions?: string | null }>(instructionsUrl({ scope, id: containerId }), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instructions: value }),
        })
        queryClient.setQueryData(queryKeys.wardrobe.instructions(encodeWardrobeContainer({ scope, id: containerId })), data.instructions ?? null)
        return true
      } catch (err) {
        console.warn('[useWardrobeInstructions] Failed to save dressing instructions', err)
        return false
      } finally {
        setSaving(false)
      }
    },
    [queryClient, scope, containerId],
  )

  return {
    instructions: scope ? (query.data ?? null) : null,
    loading: query.isFetching,
    fetched: !!scope && query.isFetched,
    saving,
    save,
  }
}
