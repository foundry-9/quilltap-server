import { useCallback, useMemo } from 'react'
import { useCharactersList } from '@/lib/hooks/use-characters-list'

interface UserCharacterBasic {
  id: string
  name: string
  title?: string | null
}

interface UseUserCharacterDisplayNameResult {
  /**
   * Format a character's display name, including title only if disambiguation is needed
   * @param character - The character to format (needs id, name, and optionally title)
   * @returns Formatted display name
   */
  formatCharacterName: (character: UserCharacterBasic | null | undefined) => string

  /**
   * Check if a character name needs disambiguation (has duplicates)
   * @param name - The character name to check
   * @returns true if there are multiple user-controlled characters with this name
   */
  needsDisambiguation: (name: string) => boolean

  /**
   * Whether the character list has loaded
   */
  loading: boolean
}

/**
 * Derive the set of names shared by more than one user-controlled character.
 * Used as the query `select` so the duplicate-name Set is memoised by TanStack
 * Query (referentially stable across renders), which matters because every
 * ChatCard mounts this hook — an unstable Set identity would thrash their memo.
 */
function computeDuplicateNames(characters: UserCharacterBasic[]): Set<string> {

  const nameCounts = new Map<string, number>()
  for (const character of characters) {
    nameCounts.set(character.name, (nameCounts.get(character.name) || 0) + 1)
  }

  const duplicates = new Set<string>()
  for (const [name, count] of nameCounts) {
    if (count > 1) duplicates.add(name)
  }
  return duplicates
}

// Stable empty-Set fallback for the pre-load / error state.
const EMPTY_NAMES: Set<string> = new Set()

/**
 * Hook to format user-controlled character display names, showing titles only when needed for disambiguation.
 * Fetches the user's characters (controlledBy=user) and tracks which names have duplicates.
 * Backed by the shared TanStack Query cache so multiple ChatCard instances share a single fetch.
 */
export function useUserCharacterDisplayName(): UseUserCharacterDisplayNameResult {
  const { data: duplicateNames = EMPTY_NAMES, isLoading: loading } = useCharactersList<
    UserCharacterBasic,
    Set<string>
  >({ controlledBy: 'user' }, { select: computeDuplicateNames, staleTime: Infinity })

  const needsDisambiguation = useCallback(
    (name: string) => duplicateNames.has(name),
    [duplicateNames]
  )

  const formatCharacterName = useCallback(
    (character: UserCharacterBasic | null | undefined): string => {
      if (!character) return ''

      // Show title only if this name has duplicates and the character has a title
      if (character.title && duplicateNames.has(character.name)) {
        return `${character.name} (${character.title})`
      }

      return character.name
    },
    [duplicateNames]
  )

  return useMemo(
    () => ({ formatCharacterName, needsDisambiguation, loading }),
    [formatCharacterName, needsDisambiguation, loading]
  )
}
