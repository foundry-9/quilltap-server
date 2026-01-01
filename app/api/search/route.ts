// Global Search API: Search across chats, characters, personas, tags, and memories
// GET /api/search?q=query&types=chats,characters,personas,tags,memories&limit=40

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedHandler, type AuthenticatedContext } from '@/lib/api/middleware'
import { getUserRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import type { Tag } from '@/lib/schemas/types'

const searchLogger = logger.child({ module: 'global-search' })

// Valid entity types for search
const VALID_TYPES = ['chats', 'characters', 'personas', 'tags', 'memories'] as const
type SearchType = typeof VALID_TYPES[number]

// Match priority levels (lower = better match)
// 0=exact phrase, 1=all terms AND, 2=individual term, 3=no match (not included in results)
type MatchPriority = 0 | 1 | 2 | 3

// Search result types
interface BaseSearchResult {
  id: string
  type: SearchType
  name: string
  matchedField: string
  matchedValue: string
  snippet: string
  url: string
  matchedTag?: {
    id: string
    name: string
  }
  matchPriority: MatchPriority  // 0=exact phrase, 1=all terms AND, 2=single term
  createdAt: string
  updatedAt: string
}

interface ChatSearchResult extends BaseSearchResult {
  type: 'chats'
  characterNames?: string[]
  personaName?: string
  messageCount?: number
  matchedViaCharacter?: {
    id: string
    name: string
  }
  matchedViaPersona?: {
    id: string
    name: string
  }
}

interface CharacterSearchResult extends BaseSearchResult {
  type: 'characters'
  title?: string | null
  avatarUrl?: string | null
  isFavorite?: boolean
}

interface PersonaSearchResult extends BaseSearchResult {
  type: 'personas'
  title?: string | null
  avatarUrl?: string | null
}

interface TagSearchResult extends BaseSearchResult {
  type: 'tags'
  usageCount: number
  quickHide: boolean
}

interface MemorySearchResult extends BaseSearchResult {
  type: 'memories'
  characterId: string
  characterName?: string
  importance: number
  source: 'AUTO' | 'MANUAL'
}

type SearchResult = ChatSearchResult | CharacterSearchResult | PersonaSearchResult | TagSearchResult | MemorySearchResult

interface SearchResponse {
  results: SearchResult[]
  totalCount: number
  query: string
  types: SearchType[]
}

// Helper to create a snippet from content
function createSnippet(content: string, query: string, maxLength = 100): string {
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

// Parse query into terms for multi-term matching
function parseQueryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(term => term.length >= 2)
}

// Check if string matches query, returning the match priority
// Priority: 0=exact phrase match, 1=all terms match (AND), 2=any single term, 3=no match
function getMatchPriority(value: string | null | undefined, query: string, terms: string[]): MatchPriority {
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

// Helper to check if string matches query (legacy - returns boolean)
function matchesQuery(value: string | null | undefined, query: string): boolean {
  if (!value) return false
  return value.toLowerCase().includes(query.toLowerCase())
}

// Check if value matches using multi-term logic (returns true for any match)
function matchesQueryMultiTerm(value: string | null | undefined, query: string, terms: string[]): boolean {
  return getMatchPriority(value, query, terms) < 3
}

// Helper to find which field matched (with multi-term support)
function findMatchedField(
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

// GET /api/search - Global search
export const GET = createAuthenticatedHandler(async (req: NextRequest, { user }: AuthenticatedContext) => {
  const startTime = Date.now()

  try {
    // Use user-scoped repositories for automatic filtering
    const repos = getUserRepositories(user.id)

    const searchParams = req.nextUrl.searchParams
    const query = searchParams.get('q')?.trim()
    const typesParam = searchParams.get('types')
    const limitParam = searchParams.get('limit')

    // Validate query
    if (!query || query.length < 2) {
      searchLogger.debug('Search query too short', { query })
      return NextResponse.json(
        { error: 'Search query must be at least 2 characters' },
        { status: 400 }
      )
    }

    // Parse types (default to all)
    let types: SearchType[] = [...VALID_TYPES]
    if (typesParam) {
      const requestedTypes = typesParam.split(',').map(t => t.trim()) as SearchType[]
      types = requestedTypes.filter(t => VALID_TYPES.includes(t))
      if (types.length === 0) {
        types = [...VALID_TYPES]
      }
    }

    // Parse limit (default 40, max 100)
    // Default of 40 accommodates the minimum per-type guarantees (5+3+15+3+10=36)
    const limit = Math.min(Math.max(1, parseInt(limitParam || '40', 10) || 40), 100)

    searchLogger.debug('Executing global search', {
      userId: user.id,
      query,
      types,
      limit,
    })

    const results: SearchResult[] = []
    const lowerQuery = query.toLowerCase()
    const terms = parseQueryTerms(query)

    searchLogger.debug('Parsed search terms', { query, terms, termCount: terms.length })

    // Load all tags for tag-based matching
    const allTags = await repos.tags.findAll()
    const tagMap = new Map<string, Tag>(allTags.map(t => [t.id, t]))

    // Find tags that match the query (with priority tracking)
    const matchingTagsWithPriority = allTags
      .map(t => ({
        tag: t,
        priority: getMatchPriority(t.name, query, terms)
      }))
      .filter(({ priority }) => priority < 3)
    const matchingTags = matchingTagsWithPriority.map(({ tag }) => tag)
    const matchingTagIds = new Set(matchingTags.map(t => t.id))
    const tagPriorityMap = new Map(matchingTagsWithPriority.map(({ tag, priority }) => [tag.id, priority]))

    // Pre-load all entities for cross-referencing
    const allCharacters = await repos.characters.findAll()
    const allPersonas = await repos.personas.findAll()
    const allChats = await repos.chats.findAll()

    const charMap = new Map(allCharacters.map(c => [c.id, c]))
    const personaMap = new Map(allPersonas.map(p => [p.id, p]))

    // Track matched characters and personas for related chat lookup
    const matchedCharacterIds = new Set<string>()
    const matchedPersonaIds = new Set<string>()

    // Search characters
    if (types.includes('characters')) {
      const characterFields = ['name', 'title', 'description', 'personality', 'scenario', 'systemPrompt']

      searchLogger.debug('Searching characters', {
        totalCharacters: allCharacters.length,
        characterNames: allCharacters.map(c => c.name),
        query,
        terms,
      })

      for (const char of allCharacters) {
        // Check if any tag matches (get best priority tag match)
        const matchedTagId = char.tags.find(tagId => matchingTagIds.has(tagId))
        const matchedTag = matchedTagId ? tagMap.get(matchedTagId) : undefined
        const tagMatchPriority = matchedTagId ? (tagPriorityMap.get(matchedTagId) ?? 3) : 3

        // Check direct field matches (now returns priority)
        const match = findMatchedField(char as unknown as Record<string, unknown>, query, characterFields, terms)

        searchLogger.debug('Character search check', {
          characterName: char.name,
          characterId: char.id,
          query,
          terms,
          matchResult: match ? { field: match.field, priority: match.priority, matched: true } : { matched: false },
          tagMatch: matchedTag ? matchedTag.name : null,
          tagMatchPriority,
        })

        if (match || matchedTag) {
          // Track this character for related chat lookup
          matchedCharacterIds.add(char.id)

          // Determine best match priority (lower is better)
          const matchPriority: MatchPriority = match
            ? (matchedTag ? Math.min(match.priority, tagMatchPriority) as MatchPriority : match.priority)
            : tagMatchPriority as MatchPriority

          results.push({
            id: char.id,
            type: 'characters',
            name: char.name,
            matchedField: matchedTag ? 'tag' : match!.field,
            matchedValue: matchedTag ? matchedTag.name : match!.value,
            snippet: matchedTag
              ? `Tagged with "${matchedTag.name}"${char.description ? ': ' + createSnippet(char.description, '', 60) : ''}`
              : createSnippet(match!.value, query),
            url: `/characters/${char.id}`,
            matchedTag: matchedTag ? { id: matchedTag.id, name: matchedTag.name } : undefined,
            matchPriority,
            title: char.title,
            avatarUrl: char.avatarUrl,
            isFavorite: char.isFavorite,
            createdAt: char.createdAt,
            updatedAt: char.updatedAt,
          })
        }
      }
    }

    // Search personas
    if (types.includes('personas')) {
      const personaFields = ['name', 'title', 'description', 'personalityTraits']

      for (const persona of allPersonas) {
        // Check if any tag matches (get best priority tag match)
        const matchedTagId = persona.tags.find(tagId => matchingTagIds.has(tagId))
        const matchedTag = matchedTagId ? tagMap.get(matchedTagId) : undefined
        const tagMatchPriority = matchedTagId ? (tagPriorityMap.get(matchedTagId) ?? 3) : 3

        // Check direct field matches (now returns priority)
        const match = findMatchedField(persona as unknown as Record<string, unknown>, query, personaFields, terms)

        if (match || matchedTag) {
          // Track this persona for related chat lookup
          matchedPersonaIds.add(persona.id)

          // Determine best match priority (lower is better)
          const matchPriority: MatchPriority = match
            ? (matchedTag ? Math.min(match.priority, tagMatchPriority) as MatchPriority : match.priority)
            : tagMatchPriority as MatchPriority

          results.push({
            id: persona.id,
            type: 'personas',
            name: persona.name,
            matchedField: matchedTag ? 'tag' : match!.field,
            matchedValue: matchedTag ? matchedTag.name : match!.value,
            snippet: matchedTag
              ? `Tagged with "${matchedTag.name}"${persona.description ? ': ' + createSnippet(persona.description, '', 60) : ''}`
              : createSnippet(match!.value, query),
            url: `/personas/${persona.id}`,
            matchedTag: matchedTag ? { id: matchedTag.id, name: matchedTag.name } : undefined,
            matchPriority,
            title: persona.title,
            avatarUrl: persona.avatarUrl,
            createdAt: persona.createdAt,
            updatedAt: persona.updatedAt,
          })
        }
      }
    }

    // Search chats
    if (types.includes('chats')) {
      // Track which chat IDs we've already added to avoid duplicates
      const addedChatIds = new Set<string>()

      for (const chat of allChats) {
        // Check if any tag matches (get best priority tag match)
        const matchedTagId = chat.tags.find(tagId => matchingTagIds.has(tagId))
        const matchedTag = matchedTagId ? tagMap.get(matchedTagId) : undefined
        const tagMatchPriority = matchedTagId ? (tagPriorityMap.get(matchedTagId) ?? 3) : 3

        // Get participant info
        const charParticipants = chat.participants
          .filter(p => p.type === 'CHARACTER' && p.characterId)
          .map(p => charMap.get(p.characterId!))
          .filter(Boolean)
        const characterNames = charParticipants.map(c => c!.name)

        const personaParticipant = chat.participants.find(p => p.type === 'PERSONA' && p.personaId)
        const persona = personaParticipant?.personaId ? personaMap.get(personaParticipant.personaId) : undefined

        // Check title match (with priority)
        const titlePriority = getMatchPriority(chat.title, query, terms)
        const titleMatch = titlePriority < 3

        // Check character name match (direct text match in chat, with priority)
        let charNamePriority: MatchPriority = 3
        for (const name of characterNames) {
          const priority = getMatchPriority(name, query, terms)
          if (priority < charNamePriority) charNamePriority = priority
        }
        const charNameMatch = charNamePriority < 3

        // Check context summary match (with priority)
        const contextPriority = getMatchPriority(chat.contextSummary, query, terms)
        const contextMatch = contextPriority < 3

        // Check if chat contains a matched character (for related results)
        const matchedCharParticipant = chat.participants
          .filter(p => p.type === 'CHARACTER' && p.characterId)
          .find(p => matchedCharacterIds.has(p.characterId!))
        const matchedViaCharacter = matchedCharParticipant?.characterId
          ? charMap.get(matchedCharParticipant.characterId)
          : undefined

        // Check if chat contains a matched persona (for related results)
        const matchedViaPersona = personaParticipant?.personaId && matchedPersonaIds.has(personaParticipant.personaId)
          ? personaMap.get(personaParticipant.personaId)
          : undefined

        // Include chat if it matches directly OR if it contains a matched character/persona
        if (titleMatch || charNameMatch || contextMatch || matchedTag || matchedViaCharacter || matchedViaPersona) {
          // Skip if we've already added this chat
          if (addedChatIds.has(chat.id)) continue
          addedChatIds.add(chat.id)

          let matchedField = 'title'
          let matchedValue = chat.title
          let snippet = chat.title

          // Determine best match priority across all match types
          let matchPriority: MatchPriority = 3
          if (titleMatch) matchPriority = Math.min(matchPriority, titlePriority) as MatchPriority
          if (charNameMatch) matchPriority = Math.min(matchPriority, charNamePriority) as MatchPriority
          if (contextMatch) matchPriority = Math.min(matchPriority, contextPriority) as MatchPriority
          if (matchedTag) matchPriority = Math.min(matchPriority, tagMatchPriority) as MatchPriority
          // Related results get lowest priority (2) if no direct match
          if (matchPriority === 3 && (matchedViaCharacter || matchedViaPersona)) matchPriority = 2

          if (matchedTag) {
            matchedField = 'tag'
            matchedValue = matchedTag.name
            snippet = `Tagged with "${matchedTag.name}" - ${chat.title}`
          } else if (matchedViaCharacter && !titleMatch && !charNameMatch && !contextMatch) {
            // This chat is included because it contains a matched character
            matchedField = 'relatedCharacter'
            matchedValue = matchedViaCharacter.name
            snippet = `Chat with ${matchedViaCharacter.name}`
          } else if (matchedViaPersona && !titleMatch && !charNameMatch && !contextMatch) {
            // This chat is included because it contains a matched persona
            matchedField = 'relatedPersona'
            matchedValue = matchedViaPersona.name
            snippet = `Chat as ${matchedViaPersona.name}`
          } else if (charNameMatch && !titleMatch) {
            const matchedCharName = characterNames.find(name => matchesQueryMultiTerm(name, query, terms))!
            matchedField = 'character'
            matchedValue = matchedCharName
            snippet = `Chat with ${matchedCharName}`
          } else if (contextMatch && !titleMatch) {
            matchedField = 'contextSummary'
            matchedValue = chat.contextSummary!
            snippet = createSnippet(chat.contextSummary!, query)
          }

          results.push({
            id: chat.id,
            type: 'chats',
            name: chat.title,
            matchedField,
            matchedValue,
            snippet,
            url: `/chats/${chat.id}`,
            matchedTag: matchedTag ? { id: matchedTag.id, name: matchedTag.name } : undefined,
            matchPriority,
            characterNames,
            personaName: persona?.name,
            messageCount: chat.messageCount,
            matchedViaCharacter: matchedViaCharacter ? { id: matchedViaCharacter.id, name: matchedViaCharacter.name } : undefined,
            matchedViaPersona: matchedViaPersona ? { id: matchedViaPersona.id, name: matchedViaPersona.name } : undefined,
            createdAt: chat.createdAt,
            updatedAt: chat.updatedAt,
          })
        }
      }
    }

    // Search tags
    if (types.includes('tags')) {
      for (const { tag, priority } of matchingTagsWithPriority) {
        // Count usage across entities (use pre-loaded data)
        const usageCount =
          allCharacters.filter(c => c.tags.includes(tag.id)).length +
          allPersonas.filter(p => p.tags.includes(tag.id)).length +
          allChats.filter(c => c.tags.includes(tag.id)).length

        results.push({
          id: tag.id,
          type: 'tags',
          name: tag.name,
          matchedField: 'name',
          matchedValue: tag.name,
          snippet: `Tag used ${usageCount} time${usageCount !== 1 ? 's' : ''}`,
          url: `/tags/${tag.id}`,
          matchPriority: priority,
          usageCount,
          quickHide: tag.quickHide,
          createdAt: tag.createdAt,
          updatedAt: tag.updatedAt,
        })
      }
    }

    // Search memories
    if (types.includes('memories')) {
      for (const char of allCharacters) {
        const memories = await repos.memories.findByCharacterId(char.id)
        const memoryFields = ['content', 'summary']

        for (const memory of memories) {
          // Check if any tag matches (get best priority tag match)
          const matchedTagId = memory.tags.find(tagId => matchingTagIds.has(tagId))
          const matchedTag = matchedTagId ? tagMap.get(matchedTagId) : undefined
          const tagMatchPriority = matchedTagId ? (tagPriorityMap.get(matchedTagId) ?? 3) : 3

          // Check keywords with multi-term support
          let keywordPriority: MatchPriority = 3
          for (const keyword of memory.keywords) {
            const priority = getMatchPriority(keyword, query, terms)
            if (priority < keywordPriority) keywordPriority = priority
          }
          const keywordMatch = keywordPriority < 3

          // Check field matches (now returns priority)
          const match = findMatchedField(memory as unknown as Record<string, unknown>, query, memoryFields, terms)

          if (match || keywordMatch || matchedTag) {
            let matchedField = match?.field || 'keywords'
            let matchedValue = match?.value || memory.keywords.find(k => matchesQueryMultiTerm(k, query, terms)) || ''
            let snippet = match ? createSnippet(match.value, query) : memory.summary

            // Determine best match priority
            let matchPriority: MatchPriority = 3
            if (match) matchPriority = Math.min(matchPriority, match.priority) as MatchPriority
            if (keywordMatch) matchPriority = Math.min(matchPriority, keywordPriority) as MatchPriority
            if (matchedTag) matchPriority = Math.min(matchPriority, tagMatchPriority) as MatchPriority

            if (matchedTag) {
              matchedField = 'tag'
              matchedValue = matchedTag.name
              snippet = `Tagged with "${matchedTag.name}" - ${createSnippet(memory.summary, '', 60)}`
            }

            results.push({
              id: memory.id,
              type: 'memories',
              name: memory.summary.substring(0, 50) + (memory.summary.length > 50 ? '...' : ''),
              matchedField,
              matchedValue,
              snippet,
              url: `/characters/${memory.characterId}/memories#${memory.id}`,
              matchedTag: matchedTag ? { id: matchedTag.id, name: matchedTag.name } : undefined,
              matchPriority,
              characterId: memory.characterId,
              characterName: charMap.get(memory.characterId)?.name,
              importance: memory.importance,
              source: memory.source,
              createdAt: memory.createdAt,
              updatedAt: memory.updatedAt,
            })
          }
        }
      }
    }

    // Sort results within each type by relevance
    // Priority order: exact phrase (0) > all terms AND (1) > single term (2)
    const sortWithinType = (a: SearchResult, b: SearchResult): number => {
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

      // Related results (chats via character/persona) after direct matches
      const aIsRelated = a.type === 'chats' && ((a as ChatSearchResult).matchedViaCharacter || (a as ChatSearchResult).matchedViaPersona)
      const bIsRelated = b.type === 'chats' && ((b as ChatSearchResult).matchedViaCharacter || (b as ChatSearchResult).matchedViaPersona)
      if (aIsRelated && !bIsRelated) return 1
      if (bIsRelated && !aIsRelated) return -1

      // Then by date
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    }

    // Group results by type
    const resultsByType: Record<SearchType, SearchResult[]> = {
      characters: [],
      personas: [],
      chats: [],
      tags: [],
      memories: [],
    }

    for (const result of results) {
      resultsByType[result.type].push(result)
    }

    // Sort each type's results
    for (const type of Object.keys(resultsByType) as SearchType[]) {
      resultsByType[type].sort(sortWithinType)
    }

    // Minimum results per type (ensures variety in results)
    const minPerType: Record<SearchType, number> = {
      characters: 5,
      personas: 3,
      chats: 15,
      tags: 3,
      memories: 10,
    }

    // Build final results with minimum guarantees per type
    // First pass: take minimum from each type (up to what's available)
    const limitedResults: SearchResult[] = []
    const takenPerType: Record<SearchType, number> = {
      characters: 0,
      personas: 0,
      chats: 0,
      tags: 0,
      memories: 0,
    }

    // Priority order for filling minimum slots
    const typeOrder: SearchType[] = ['characters', 'personas', 'chats', 'tags', 'memories']

    // First pass: ensure minimums
    for (const type of typeOrder) {
      const available = resultsByType[type]
      const minForType = Math.min(minPerType[type], available.length)

      for (let i = 0; i < minForType && limitedResults.length < limit; i++) {
        limitedResults.push(available[i])
        takenPerType[type]++
      }
    }

    // Second pass: fill remaining slots with best remaining results across all types
    if (limitedResults.length < limit) {
      // Collect remaining results from all types
      const remaining: SearchResult[] = []
      for (const type of typeOrder) {
        const available = resultsByType[type]
        for (let i = takenPerType[type]; i < available.length; i++) {
          remaining.push(available[i])
        }
      }

      // Sort remaining by type priority, then by relevance within type
      const typePriority: Record<SearchType, number> = {
        characters: 0,
        personas: 1,
        chats: 2,
        tags: 3,
        memories: 4,
      }

      remaining.sort((a, b) => {
        const typeDiff = typePriority[a.type] - typePriority[b.type]
        if (typeDiff !== 0) return typeDiff
        return sortWithinType(a, b)
      })

      // Add remaining until we hit the limit
      for (const result of remaining) {
        if (limitedResults.length >= limit) break
        limitedResults.push(result)
      }
    }

    // Final sort for display: group by type in priority order
    const typePriority: Record<SearchType, number> = {
      characters: 0,
      personas: 1,
      chats: 2,
      tags: 3,
      memories: 4,
    }

    limitedResults.sort((a, b) => {
      const typeDiff = typePriority[a.type] - typePriority[b.type]
      if (typeDiff !== 0) return typeDiff
      return sortWithinType(a, b)
    })

    const duration = Date.now() - startTime
    searchLogger.info('Global search completed', {
      userId: user.id,
      query,
      types,
      totalResults: results.length,
      returnedResults: limitedResults.length,
      durationMs: duration,
    })

    const response: SearchResponse = {
      results: limitedResults,
      totalCount: results.length,
      query,
      types,
    }

    return NextResponse.json(response)
  } catch (error) {
    searchLogger.error('Global search failed', { error: error instanceof Error ? error.message : String(error) }, error as Error)
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    )
  }
})
