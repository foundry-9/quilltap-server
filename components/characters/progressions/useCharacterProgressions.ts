'use client'

/**
 * The Aurora progressions editor's data hook.
 *
 * Progressions live under one reserved key inside the character's vault
 * `metadata.json`, so there is no route of their own to call: reads come off
 * the hydrated character, and a save sets (or unsets) that one key through
 * `PUT /api/v1/characters/[id]?action=patch-metadata`, which merges it on the
 * server under the character's write chain. Every other key the user has out
 * there — `faction`, `hasAnsibleAccess`, whatever they invented — is never
 * sent, so it can never be eaten by a stale copy, and the fact-sheet card's
 * save cannot race this one.
 *
 * The write is built from the RAW `progressions` object the vault holds, not
 * from the parsed map the card lists (#239). `parseProgressions` drops entries
 * it cannot read — malformed, over the ceiling, an illegal id — and the card
 * promises those are only being *skipped*; a write built from the parsed map
 * would have erased every one of them. So a save or delete changes exactly the
 * one id it names and hands every other raw entry back byte-for-byte.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { parseProgressions } from '@/lib/progressions/engine'
import { PROGRESSIONS_METADATA_KEY, type Progression } from '@/lib/progressions/schema'
import { useCharacter } from '@/app/aurora/[id]/hooks/useCharacter'

export interface UseCharacterProgressionsResult {
  /** The character's valid progressions, keyed by id. Malformed entries are dropped. */
  progressions: Record<string, Progression>
  /** Ids the vault holds that this editor could not parse, so the card can say so. */
  invalidIds: string[]
  /** True while the tombstone rule would refuse the PUT anyway. */
  isArchived: boolean
  isLoading: boolean
  /** Write one entry. Every other entry — readable or not — and the rest of metadata survive. */
  save: ReturnType<typeof useSaveProgressions<{ id: string; progression: Progression }>>
  /** Delete one entry by id. Every other entry, readable or not, survives. */
  remove: ReturnType<typeof useSaveProgressions<string>>
}

/** What a write to the reserved key starts from: the raw object, or null when the key itself is unreadable. */
type RawProgressions = Record<string, unknown> | null

/** The vault's raw `progressions` object, untouched by parsing. `{}` when absent; null when not an object. */
export function rawProgressionsOf(metadata: unknown): RawProgressions {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return {}
  const raw = (metadata as Record<string, unknown>)[PROGRESSIONS_METADATA_KEY]
  if (raw === undefined) return {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

const UNREADABLE_KEY_MESSAGE =
  'The progressions entry in metadata.json is not an object, so nothing can be added beside it. Mend the file first.'

function useSaveProgressions<TInput>(
  characterId: string,
  raw: RawProgressions,
  apply: (current: Record<string, unknown>, input: TInput) => Record<string, unknown>,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: TInput) => {
      // Refuse rather than overwrite a reserved key we cannot read at all.
      if (raw === null) throw new Error(UNREADABLE_KEY_MESSAGE)
      const next = apply({ ...raw }, input)
      const patch =
        Object.keys(next).length === 0
          ? { unset: [PROGRESSIONS_METADATA_KEY] }
          : { set: { [PROGRESSIONS_METADATA_KEY]: next } }
      return apiFetch<unknown>(`/api/v1/characters/${characterId}?action=patch-metadata`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.characters.detail(characterId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.characters.all })
    },
  })
}

export function useCharacterProgressions(characterId: string): UseCharacterProgressionsResult {
  // The character page's own read: one cache entry, one fetch.
  const { character, isLoading } = useCharacter(characterId)

  const invalidIds: string[] = []
  const progressions = parseProgressions(character?.metadata, (id) => {
    invalidIds.push(id)
  })

  const raw = rawProgressionsOf(character?.metadata)
  const save = useSaveProgressions(characterId, raw, (current, { id, progression }: { id: string; progression: Progression }) => ({
    ...current,
    [id]: progression,
  }))
  const remove = useSaveProgressions(characterId, raw, (current, id: string) => {
    delete current[id]
    return current
  })

  return {
    progressions,
    invalidIds,
    isArchived: Boolean(character?.archivedAt),
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
