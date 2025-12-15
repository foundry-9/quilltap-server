import { useEffect, useState, useCallback, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'

interface PersonaBasic {
  id: string
  name: string
  title?: string | null
}

interface UsePersonaDisplayNameResult {
  /**
   * Format a persona's display name, including title only if disambiguation is needed
   * @param persona - The persona to format (needs id, name, and optionally title)
   * @returns Formatted display name
   */
  formatPersonaName: (persona: PersonaBasic | null | undefined) => string

  /**
   * Check if a persona name needs disambiguation (has duplicates)
   * @param name - The persona name to check
   * @returns true if there are multiple personas with this name
   */
  needsDisambiguation: (name: string) => boolean

  /**
   * Whether the persona list has loaded
   */
  loading: boolean
}

/**
 * Hook to format persona display names, showing titles only when needed for disambiguation.
 * Fetches the user's personas and tracks which names have duplicates.
 */
export function usePersonaDisplayName(): UsePersonaDisplayNameResult {
  const [duplicateNames, setDuplicateNames] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchPersonas = async () => {
      try {
        const res = await fetch('/api/personas')
        if (!res.ok) {
          if (res.status === 401) {
            clientLogger.debug('Not authenticated, cannot check persona names')
            return
          }
          throw new Error(`Failed to fetch personas: ${res.status}`)
        }

        const data = await res.json()
        const personas: PersonaBasic[] = data.personas || []

        // Count occurrences of each name
        const nameCounts = new Map<string, number>()
        for (const persona of personas) {
          const count = nameCounts.get(persona.name) || 0
          nameCounts.set(persona.name, count + 1)
        }

        // Find names that appear more than once
        const duplicates = new Set<string>()
        for (const [name, count] of nameCounts) {
          if (count > 1) {
            duplicates.add(name)
          }
        }

        setDuplicateNames(duplicates)
        clientLogger.debug('Persona name disambiguation loaded', {
          totalPersonas: personas.length,
          duplicateNames: duplicates.size,
        })
      } catch (err) {
        clientLogger.warn('Error fetching personas for display name disambiguation', {
          error: err instanceof Error ? err.message : String(err),
        })
      } finally {
        setLoading(false)
      }
    }

    fetchPersonas()
  }, [])

  const needsDisambiguation = useCallback(
    (name: string) => duplicateNames.has(name),
    [duplicateNames]
  )

  const formatPersonaName = useCallback(
    (persona: PersonaBasic | null | undefined): string => {
      if (!persona) return ''

      // Show title only if this name has duplicates and the persona has a title
      if (persona.title && duplicateNames.has(persona.name)) {
        return `${persona.name} (${persona.title})`
      }

      return persona.name
    },
    [duplicateNames]
  )

  return useMemo(
    () => ({ formatPersonaName, needsDisambiguation, loading }),
    [formatPersonaName, needsDisambiguation, loading]
  )
}
