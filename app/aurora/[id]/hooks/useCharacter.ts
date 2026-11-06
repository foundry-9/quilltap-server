'use client'

/**
 * The character page's reads, on TanStack Query.
 *
 * `useCharacter` reads the row under `queryKeys.characters.detail(id)` — the
 * same key and response shape the progressions section and the pronoun
 * guidance filter already share, so the page, its sections and those readers
 * are one cache entry that realtime `characters` hints refresh together.
 * `useCharacterStats` is the header's counts, groups and vault summary.
 * `useCharacterPageSupport` is the reference data the sections need (the
 * connection profiles and the user-controlled characters for the partner
 * picker), shared with every other surface that reads them.
 *
 * @module app/aurora/[id]/hooks/useCharacter
 */

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'
import type {
  Character,
  CharacterStats,
  CharacterVaultSummary,
  GroupBadge,
  UserControlledCharacter,
} from '../types'

export interface CharacterResponse {
  character: Character
}

export function useCharacter(characterId: string) {
  const query = useQuery({
    queryKey: queryKeys.characters.detail(characterId),
    queryFn: ({ signal }) =>
      apiFetch<CharacterResponse>(`/api/v1/characters/${characterId}`, { signal, cache: 'no-store' }),
  })
  return {
    character: query.data?.character ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export interface CharacterStatsResponse {
  stats: CharacterStats | null
  groups: GroupBadge[]
  vault: CharacterVaultSummary | null
}

export function useCharacterStats(characterId: string) {
  const query = useQuery({
    queryKey: queryKeys.characters.stats(characterId),
    queryFn: ({ signal }) =>
      apiFetch<CharacterStatsResponse>(`/api/v1/characters/${characterId}?action=stats`, {
        signal,
        cache: 'no-store',
      }),
  })
  return {
    stats: query.data?.stats ?? null,
    groups: query.data?.groups ?? [],
    vault: query.data?.vault ?? null,
    refetch: query.refetch,
  }
}

interface UserCharactersResponse {
  characters?: Array<{ id: string; name: string; title?: string | null }>
}

const EMPTY_USER_CHARACTERS: UserControlledCharacter[] = []

export function useCharacterPageSupport() {
  const { profiles } = useConnectionProfiles()
  const userCharacters = useQuery({
    // The same key (and URL) `useUserCharacterDisplayName` reads, without its
    // `select`, so the two share one fetch.
    queryKey: queryKeys.characters.list({ controlledBy: 'user' }),
    queryFn: ({ signal }) =>
      apiFetch<UserCharactersResponse>('/api/v1/characters?controlledBy=user', { signal }),
  })
  const userControlledCharacters: UserControlledCharacter[] = userCharacters.data?.characters
    ? userCharacters.data.characters.map((c) => ({ id: c.id, name: c.name, title: c.title ?? null }))
    : EMPTY_USER_CHARACTERS
  return { profiles, userControlledCharacters }
}
