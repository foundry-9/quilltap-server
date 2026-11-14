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
import { useCharactersList } from '@/lib/hooks/use-characters-list'
import { useProjectsQuery } from '@/lib/hooks/use-projects'
import { useGroupsQuery } from '@/lib/hooks/use-groups'

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
  const characters = useCharactersList<CatalogueCharacter>()
  const projects = useProjectsQuery<CatalogueEntry>()
  const groups = useGroupsQuery<CatalogueEntry>()
  return {
    characters: useMemo(() => [...(characters.data ?? [])].sort(byName), [characters.data]),
    projects: useMemo(
      () => (projects.data ?? []).map((p) => ({ id: p.id, name: p.name || 'Untitled project' })).sort(byName),
      [projects.data],
    ),
    groups: useMemo(
      () => (groups.data ?? []).map((g) => ({ id: g.id, name: g.name || 'Untitled group' })).sort(byName),
      [groups.data],
    ),
    charactersSettled: characters.isFetched,
    loading: characters.isLoading || projects.isLoading || groups.isLoading,
  }
}
