import { useEffect, useState, useCallback, useMemo } from 'react'

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

// ============================================================================
// Module-level cache for character disambiguation data
// Shared across all hook instances to avoid redundant API calls
// (each ChatCard mounts this hook, so without caching N cards = N fetches)
// ============================================================================

let cachedDuplicateNames: Set<string> | null = null
let cachePromise: Promise<Set<string>> | null = null

/**
 * Reset the module-level cache. Used by tests to ensure clean state between test cases.
 */
export function resetDisplayNameCache(): void {
  cachedDuplicateNames = null
  cachePromise = null
}

function fetchDuplicateNames(): Promise<Set<string>> {
  // Return existing promise if fetch is in progress (dedup concurrent calls)
  if (cachePromise) return cachePromise

  // Return cached result if available
  if (cachedDuplicateNames) return Promise.resolve(cachedDuplicateNames)

  cachePromise = (async () => {
    try {
      const res = await fetch('/api/v1/characters?controlledBy=user')
      if (!res.ok) {
        return new Set<string>()
      }

      const data = await res.json()
      const characters: UserCharacterBasic[] = Array.isArray(data) ? data : (data.characters || [])

      // Count occurrences of each name
      const nameCounts = new Map<string, number>()
      for (const character of characters) {
        const count = nameCounts.get(character.name) || 0
        nameCounts.set(character.name, count + 1)
      }

      // Find names that appear more than once
      const duplicates = new Set<string>()
      for (const [name, count] of nameCounts) {
        if (count > 1) {
          duplicates.add(name)
        }
      }

      cachedDuplicateNames = duplicates
      return duplicates
    } catch {
      return new Set<string>()
    } finally {
      cachePromise = null
    }
  })()

  return cachePromise
}

/**
 * Hook to format user-controlled character display names, showing titles only when needed for disambiguation.
 * Fetches the user's characters (controlledBy=user) and tracks which names have duplicates.
 * Results are cached at module level so multiple ChatCard instances share a single API call.
 */
export function useUserCharacterDisplayName(): UseUserCharacterDisplayNameResult {
  const [duplicateNames, setDuplicateNames] = useState<Set<string>>(cachedDuplicateNames ?? new Set())
  const [loading, setLoading] = useState(cachedDuplicateNames === null)

  useEffect(() => {
    // If already cached, initial state handles it — no fetch needed
    if (cachedDuplicateNames) return

    let mounted = true
    fetchDuplicateNames().then(result => {
      if (mounted) {
        setDuplicateNames(result)
        setLoading(false)
      }
    })
    return () => { mounted = false }
  }, [])

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
