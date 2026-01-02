/**
 * Search Utilities
 *
 * Helper functions for global search functionality.
 */

/**
 * Match priority levels (lower = better match)
 * 0=exact phrase, 1=all terms AND, 2=individual term, 3=no match
 */
export type MatchPriority = 0 | 1 | 2 | 3

/**
 * Create a snippet from content highlighting the query match
 */
export function createSnippet(content: string, query: string, maxLength = 100): string {
  if (!content) return ''

  const lowerContent = content.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const matchIndex = lowerContent.indexOf(lowerQuery)

  if (matchIndex === -1) {
    // No direct match, return start of content
    return content.length > maxLength
      ? content.substring(0, maxLength) + '...'
      : content
  }

  // Calculate snippet window around match
  const start = Math.max(0, matchIndex - 30)
  const end = Math.min(content.length, matchIndex + query.length + 70)

  let snippet = content.substring(start, end)
  if (start > 0) snippet = '...' + snippet
  if (end < content.length) snippet = snippet + '...'

  return snippet
}

/**
 * Parse query into terms for multi-term matching
 */
export function parseQueryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(term => term.length >= 2)
}

/**
 * Check if string matches query, returning the match priority
 * Priority: 0=exact phrase match, 1=all terms match (AND), 2=any single term, 3=no match
 */
export function getMatchPriority(
  value: string | null | undefined,
  query: string,
  terms: string[]
): MatchPriority {
  if (!value) return 3
  const lowerValue = value.toLowerCase()
  const lowerQuery = query.toLowerCase()

  // Priority 0: Exact phrase match
  if (lowerValue.includes(lowerQuery)) {
    return 0
  }

  // Priority 1: All terms match (AND)
  if (terms.length > 1 && terms.every(term => lowerValue.includes(term))) {
    return 1
  }

  // Priority 2: Any single term matches
  if (terms.some(term => lowerValue.includes(term))) {
    return 2
  }

  // Priority 3: No match
  return 3
}

/**
 * Check if value matches using multi-term logic (returns true for any match)
 */
export function matchesQueryMultiTerm(
  value: string | null | undefined,
  query: string,
  terms: string[]
): boolean {
  return getMatchPriority(value, query, terms) < 3
}

/**
 * Helper to find which field matched (with multi-term support)
 */
export function findMatchedField(
  obj: Record<string, unknown>,
  query: string,
  fields: string[],
  terms: string[]
): { field: string; value: string; priority: MatchPriority } | null {
  let bestMatch: { field: string; value: string; priority: MatchPriority } | null = null

  for (const field of fields) {
    const value = obj[field]
    if (typeof value === 'string') {
      const priority = getMatchPriority(value, query, terms)
      if (priority < 3) {
        // Found a match - keep the best one (lowest priority number)
        if (!bestMatch || priority < bestMatch.priority) {
          bestMatch = { field, value, priority }
        }
        // If we found an exact match (priority 0), no need to keep looking
        if (priority === 0) break
      }
    }
  }
  return bestMatch
}

/**
 * Sort function for search results within a type
 */
export function createWithinTypeSorter<T extends {
  matchPriority: MatchPriority
  name: string
  updatedAt: string
  matchedTag?: { id: string; name: string }
}>(lowerQuery: string) {
  return (a: T, b: T): number => {
    // First sort by match priority (exact phrase > AND match > single term)
    if (a.matchPriority !== b.matchPriority) {
      return a.matchPriority - b.matchPriority
    }

    // Within same priority, name matches first
    const aNameMatch = a.name.toLowerCase().includes(lowerQuery)
    const bNameMatch = b.name.toLowerCase().includes(lowerQuery)
    if (aNameMatch && !bNameMatch) return -1
    if (bNameMatch && !aNameMatch) return 1

    // Tag matches after direct matches
    if (a.matchedTag && !b.matchedTag) return 1
    if (b.matchedTag && !a.matchedTag) return -1

    // Then by date
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  }
}
