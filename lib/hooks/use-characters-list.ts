'use client'

/**
 * `useCharactersList(filters)` — the one read of the character list
 * (`GET /api/v1/characters`).
 *
 * The filters are the endpoint's own query parameters and are folded into
 * `queryKeys.characters.list(filters)`, so each server-side filter caches
 * separately while `queryKeys.characters.all` (the `characters` realtime
 * topic, every character write) sweeps them all. With no filters the list
 * leaves archived characters out, which is what every picker wants. Callers
 * type the row and narrow with `select`.
 *
 * @module lib/hooks/use-characters-list
 */

import { queryKeys } from '@/lib/query/keys'
import { useEnvelopeListQuery, type EntityListOptions, type EntityRow } from './use-profiles'

export type CharactersListFilters = {
  /** `user`: the operator's personas; `llm`: characters a model plays. */
  controlledBy?: 'user' | 'llm'
  /** Archived characters are left out unless asked for. */
  archived?: 'include' | 'only'
  npc?: boolean
}

/** The request URL for a filter set. */
function charactersListUrl(filters?: CharactersListFilters): string {
  const params = new URLSearchParams()
  if (filters?.controlledBy) params.set('controlledBy', filters.controlledBy)
  if (filters?.archived) params.set('archived', filters.archived)
  if (filters?.npc !== undefined) params.set('npc', String(filters.npc))
  const query = params.toString()
  return query ? `/api/v1/characters?${query}` : '/api/v1/characters'
}

const unwrapCharacters = <C,>(data: { characters?: C[] }) => data.characters

export function useCharactersList<C = EntityRow, R = C[]>(
  filters?: CharactersListFilters,
  options?: EntityListOptions<C, R>,
) {
  // Undefined filter values must not split the cache from the bare list.
  const keyFilters: CharactersListFilters | undefined = filters
    ? Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined))
    : undefined
  const listFilters = keyFilters && Object.keys(keyFilters).length > 0 ? keyFilters : undefined
  return useEnvelopeListQuery<{ characters?: C[] }, C, R>({
    queryKey: queryKeys.characters.list(listFilters),
    url: charactersListUrl(listFilters),
    unwrap: unwrapCharacters,
    options,
  })
}
