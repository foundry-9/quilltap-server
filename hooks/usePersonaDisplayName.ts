import { useEffect, useState, useCallback, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'

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
 * Hook to format user-controlled character display names, showing titles only when needed for disambiguation.
 * Fetches the user's characters (controlledBy=user) and tracks which names have duplicates.
 */
export function useUserCharacterDisplayName(): UseUserCharacterDisplayNameResult {
  const [duplicateNames, setDuplicateNames] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchCharacters = async () => {
      try {
        // Fetch only user-controlled characters
        const res = await fetch('/api/v1/characters?controlledBy=user')
        if (!res.ok) {
          if (res.status === 401) {
            clientLogger.debug('Not authenticated, cannot check character names')
            return
          }
          throw new Error(`Failed to fetch characters: ${res.status}`)
        }

        const data = await res.json()
        // API returns array directly, not wrapped in { characters: [] }
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

        setDuplicateNames(duplicates)
        clientLogger.debug('Character name disambiguation loaded', {
          totalCharacters: characters.length,
          duplicateNames: duplicates.size,
        })
      } catch (err) {
        clientLogger.warn('Error fetching characters for display name disambiguation', {
          error: err instanceof Error ? err.message : String(err),
        })
      } finally {
        setLoading(false)
      }
    }

    fetchCharacters()
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
