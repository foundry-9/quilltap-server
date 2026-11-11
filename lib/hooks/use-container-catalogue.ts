'use client'

/**
 * Every container a tiered item can live in — the characters, projects and
 * groups lists, read through their shared query keys and sorted by name — for
 * the wardrobe's and the Inventory's container selects and their
 * Move / Copy to another tier dialogs. (Quilltap General is always there and
 * needs no read.)
 *
 * @module lib/hooks/use-container-catalogue
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useProjectsQuery } from '@/lib/hooks/use-projects'

export interface CatalogueEntry {
  id: string
  name: string
}

export interface CatalogueCharacter extends CatalogueEntry {
  avatarUrl?: string | null
}

export interface ContainerCatalogue {
  characters: CatalogueCharacter[]
  projects: CatalogueEntry[]
  groups: CatalogueEntry[]
  /** The characters read has settled (successfully or not) — auto-selection waits for it. */
  charactersSettled: boolean
  /** Any of the three reads is still loading. */
  loading: boolean
}

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name)

export function useContainerCatalogue(): ContainerCatalogue {
  const characters = useQuery({
    queryKey: queryKeys.characters.list(),
    queryFn: ({ signal }) => apiFetch<{ characters?: CatalogueCharacter[] }>('/api/v1/characters', { signal }),
  })
  const projects = useProjectsQuery<CatalogueEntry>()
  const groups = useQuery({
    queryKey: queryKeys.groups.list(),
    queryFn: ({ signal }) => apiFetch<{ groups?: CatalogueEntry[] }>('/api/v1/groups', { signal }),
  })
  return {
    characters: useMemo(() => [...(characters.data?.characters ?? [])].sort(byName), [characters.data]),
    projects: useMemo(
      () => (projects.data ?? []).map((p) => ({ id: p.id, name: p.name || 'Untitled project' })).sort(byName),
      [projects.data],
    ),
    groups: useMemo(
      () => (groups.data?.groups ?? []).map((g) => ({ id: g.id, name: g.name || 'Untitled group' })).sort(byName),
      [groups.data],
    ),
    charactersSettled: characters.isFetched,
    loading: characters.isLoading || projects.isLoading || groups.isLoading,
  }
}
