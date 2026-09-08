'use client'

/**
 * The Aurora progressions editor's data hook.
 *
 * Progressions live under one reserved key inside the character's vault
 * `metadata.json`, so there is no route of their own to call: reads come off
 * the hydrated character, and a save is a read-modify-write of that object
 * through the ordinary character PUT.
 *
 * The RMW is the load-bearing part. `PUT /api/v1/characters/[id]` REPLACES the
 * whole `metadata` object, so every other key the user has out there —
 * `faction`, `hasAnsibleAccess`, whatever they invented — has to be spread
 * back in or this editor would quietly eat the rest of their fact sheet.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { parseProgressions } from '@/lib/progressions/engine'
import { PROGRESSIONS_METADATA_KEY, type Progression } from '@/lib/progressions/schema'

interface CharacterWithMetadata {
  id: string
  name?: string
  archivedAt?: string | null
  metadata?: unknown
}

/** The character GET's envelope: `{ character }`, not the bare row. */
interface CharacterResponse {
  character?: CharacterWithMetadata
}

export interface UseCharacterProgressionsResult {
  /** The character's valid progressions, keyed by id. Malformed entries are dropped. */
  progressions: Record<string, Progression>
  /** Ids the vault holds that this editor could not parse, so the card can say so. */
  invalidIds: string[]
  /** True while the tombstone rule would refuse the PUT anyway. */
  isArchived: boolean
  isLoading: boolean
  /** Write one entry, stamping `updatedAt`. Everything else in metadata survives. */
  save: ReturnType<typeof useSaveProgressions>
  /** Delete one entry by id. */
  remove: ReturnType<typeof useSaveProgressions>
}

function useSaveProgressions(characterId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (next: Record<string, Progression>) => {
      // Re-read the character rather than trusting a snapshot this component
      // may have been holding since before someone else's write: the PUT
      // replaces the whole object, and a stale spread would drop their keys.
      const fresh = await apiFetch<CharacterResponse>(`/api/v1/characters/${characterId}`)
      const current = fresh.character?.metadata
      const metadata =
        typeof current === 'object' && current !== null && !Array.isArray(current)
          ? (current as Record<string, unknown>)
          : {}

      const body: Record<string, unknown> = { ...metadata }
      if (Object.keys(next).length === 0) delete body[PROGRESSIONS_METADATA_KEY]
      else body[PROGRESSIONS_METADATA_KEY] = next

      return apiFetch<unknown>(`/api/v1/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: body }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.characters.detail(characterId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.characters.all })
    },
  })
}

export function useCharacterProgressions(characterId: string): UseCharacterProgressionsResult {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.characters.detail(characterId),
    queryFn: ({ signal }) => apiFetch<CharacterResponse>(`/api/v1/characters/${characterId}`, { signal }),
  })

  const invalidIds: string[] = []
  const progressions = parseProgressions(data?.character?.metadata, (id) => {
    invalidIds.push(id)
  })

  const save = useSaveProgressions(characterId)
  const remove = useSaveProgressions(characterId)

  return {
    progressions,
    invalidIds,
    isArchived: Boolean(data?.character?.archivedAt),
    isLoading,
    save,
    remove,
  }
}

/**
 * Coerce a display name into a progression id, the way the subprompts editor
 * coerces a title into a filename: lowercase, non-identifier runs collapsed to
 * a hyphen, and a leading letter guaranteed because the pattern demands one.
 */
export function idFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  if (slug === '') return 'progression'
  return /^[a-z]/.test(slug) ? slug : `p-${slug}`.slice(0, 64)
}
