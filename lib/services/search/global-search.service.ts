/**
 * Global Search Service
 *
 * Provides unified search across chats, characters, tags, and memories.
 * Extracted from app/api/search/route.ts for reusability and testability.
 */

import { logger } from '@/lib/logger'
import type { UserScopedRepositoryContainer } from '@/lib/repositories/user-scoped'
import type { Tag, Character, ChatMetadata } from '@/lib/schemas/types'
import {
  createSnippet,
  parseQueryTerms,
  getMatchPriority,
  matchesQueryMultiTerm,
  findMatchedField,
  createWithinTypeSorter,
  type MatchPriority,
} from './search-utils'
import {
  VALID_SEARCH_TYPES,
  type SearchType,
  type SearchResult,
  type ChatSearchResult,
  type CharacterSearchResult,
  type TagSearchResult,
  type MemorySearchResult,
  type GlobalSearchResponse,
  type GlobalSearchOptions,
} from './types'

const searchLogger = logger.child({ module: 'global-search' })

/**
 * Minimum results per type (ensures variety in results)
 */
const MIN_PER_TYPE: Record<SearchType, number> = {
  characters: 5,
  chats: 15,
  tags: 3,
  memories: 10,
}

/**
 * Type priority for filling remaining slots
 */
const TYPE_PRIORITY: Record<SearchType, number> = {
  characters: 0,
  chats: 1,
  tags: 2,
  memories: 3,
}

/**
 * Execute global search across all entity types
 */
export async function executeGlobalSearch(
  repos: UserScopedRepositoryContainer,
  options: GlobalSearchOptions
): Promise<GlobalSearchResponse> {
  const startTime = Date.now()
  const { query, types = [...VALID_SEARCH_TYPES], limit = 40 } = options

  // Validate query
  if (!query || query.trim().length < 2) {
    throw new Error('Search query must be at least 2 characters')
  }

  const effectiveLimit = Math.min(Math.max(1, limit), 100)

  const results: SearchResult[] = []
  const lowerQuery = query.toLowerCase()
  const terms = parseQueryTerms(query)

  // Load all tags for tag-based matching
  const allTags = await repos.tags.findAll()
  const tagMap = new Map<string, Tag>(allTags.map(t => [t.id, t]))

  // Find tags that match the query (with priority tracking)
  const matchingTagsWithPriority = allTags
    .map(t => ({
      tag: t,
      priority: getMatchPriority(t.name, query, terms),
    }))
    .filter(({ priority }) => priority < 3)
  const matchingTags = matchingTagsWithPriority.map(({ tag }) => tag)
  const matchingTagIds = new Set(matchingTags.map(t => t.id))
  const tagPriorityMap = new Map(
    matchingTagsWithPriority.map(({ tag, priority }) => [tag.id, priority])
  )

  // Pre-load all entities for cross-referencing
  const allCharacters = await repos.characters.findAll()
  const allChats = await repos.chats.findAll()

  const charMap = new Map(allCharacters.map(c => [c.id, c]))

  // Track matched characters for related chat lookup
  const matchedCharacterIds = new Set<string>()

  // Search characters
  if (types.includes('characters')) {
    const characterResults = searchCharacters(
      allCharacters,
      query,
      terms,
      matchingTagIds,
      tagPriorityMap,
      tagMap
    )
    for (const result of characterResults) {
      matchedCharacterIds.add(result.id)
      results.push(result)
    }
  }

  // Search chats (after characters so we can find related chats)
  if (types.includes('chats')) {
    const chatResults = searchChats(
      allChats,
      query,
      terms,
      matchingTagIds,
      tagPriorityMap,
      tagMap,
      charMap,
      matchedCharacterIds
    )
    results.push(...chatResults)
  }

  // Search tags
  if (types.includes('tags')) {
    const tagResults = searchTags(
      matchingTagsWithPriority,
      allCharacters,
      allChats
    )
    results.push(...tagResults)
  }

  // Search memories
  if (types.includes('memories')) {
    const memoryResults = await searchMemories(
      repos,
      allCharacters,
      query,
      terms,
      matchingTagIds,
      tagPriorityMap,
      tagMap,
      charMap
    )
    results.push(...memoryResults)
  }

  // Apply result limiting and sorting
  const limitedResults = limitAndSortResults(results, effectiveLimit, lowerQuery, types)

  const duration = Date.now() - startTime
  searchLogger.info('Global search completed', {
    query,
    types,
    totalResults: results.length,
    returnedResults: limitedResults.length,
    durationMs: duration,
  })

  return {
    results: limitedResults,
    totalCount: results.length,
    query,
    types,
  }
}

/**
 * Search characters
 */
function searchCharacters(
  characters: Character[],
  query: string,
  terms: string[],
  matchingTagIds: Set<string>,
  tagPriorityMap: Map<string, MatchPriority>,
  tagMap: Map<string, Tag>
): CharacterSearchResult[] {
  const results: CharacterSearchResult[] = []
  const characterFields = ['name', 'title', 'description', 'personality', 'scenario', 'systemPrompt']

  for (const char of characters) {
    const matchedTagId = char.tags.find(tagId => matchingTagIds.has(tagId))
    const matchedTag = matchedTagId ? tagMap.get(matchedTagId) : undefined
    const tagMatchPriority = matchedTagId ? (tagPriorityMap.get(matchedTagId) ?? 3) : 3

    const match = findMatchedField(
      char as unknown as Record<string, unknown>,
      query,
      characterFields,
      terms
    )

    if (match || matchedTag) {
      const matchPriority: MatchPriority = match
        ? matchedTag
          ? (Math.min(match.priority, tagMatchPriority) as MatchPriority)
          : match.priority
        : (tagMatchPriority as MatchPriority)

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

  return results
}

/**
 * Search chats
 */
function searchChats(
  chats: ChatMetadata[],
  query: string,
  terms: string[],
  matchingTagIds: Set<string>,
  tagPriorityMap: Map<string, MatchPriority>,
  tagMap: Map<string, Tag>,
  charMap: Map<string, Character>,
  matchedCharacterIds: Set<string>
): ChatSearchResult[] {
  const results: ChatSearchResult[] = []
  const addedChatIds = new Set<string>()

  for (const chat of chats) {
    const matchedTagId = chat.tags.find(tagId => matchingTagIds.has(tagId))
    const matchedTag = matchedTagId ? tagMap.get(matchedTagId) : undefined
    const tagMatchPriority = matchedTagId ? (tagPriorityMap.get(matchedTagId) ?? 3) : 3

    // Get participant info
    const charParticipants = chat.participants
      .filter(p => p.type === 'CHARACTER' && p.characterId)
      .map(p => charMap.get(p.characterId!))
      .filter(Boolean)
    const characterNames = charParticipants.map(c => c!.name)

    // Check matches
    const titlePriority = getMatchPriority(chat.title, query, terms)
    const titleMatch = titlePriority < 3

    let charNamePriority: MatchPriority = 3
    for (const name of characterNames) {
      const priority = getMatchPriority(name, query, terms)
      if (priority < charNamePriority) charNamePriority = priority
    }
    const charNameMatch = charNamePriority < 3

    const contextPriority = getMatchPriority(chat.contextSummary, query, terms)
    const contextMatch = contextPriority < 3

    // Check related matches
    const matchedCharParticipant = chat.participants
      .filter(p => p.type === 'CHARACTER' && p.characterId)
      .find(p => matchedCharacterIds.has(p.characterId!))
    const matchedViaCharacter = matchedCharParticipant?.characterId
      ? charMap.get(matchedCharParticipant.characterId)
      : undefined

    if (
      titleMatch ||
      charNameMatch ||
      contextMatch ||
      matchedTag ||
      matchedViaCharacter
    ) {
      if (addedChatIds.has(chat.id)) continue
      addedChatIds.add(chat.id)

      let matchedField = 'title'
      let matchedValue = chat.title
      let snippet = chat.title

      let matchPriority: MatchPriority = 3
      if (titleMatch) matchPriority = Math.min(matchPriority, titlePriority) as MatchPriority
      if (charNameMatch) matchPriority = Math.min(matchPriority, charNamePriority) as MatchPriority
      if (contextMatch) matchPriority = Math.min(matchPriority, contextPriority) as MatchPriority
      if (matchedTag) matchPriority = Math.min(matchPriority, tagMatchPriority) as MatchPriority
      if (matchPriority === 3 && matchedViaCharacter) matchPriority = 2

      if (matchedTag) {
        matchedField = 'tag'
        matchedValue = matchedTag.name
        snippet = `Tagged with "${matchedTag.name}" - ${chat.title}`
      } else if (matchedViaCharacter && !titleMatch && !charNameMatch && !contextMatch) {
        matchedField = 'relatedCharacter'
        matchedValue = matchedViaCharacter.name
        snippet = `Chat with ${matchedViaCharacter.name}`
      } else if (charNameMatch && !titleMatch) {
        const matchedCharName = characterNames.find(name =>
          matchesQueryMultiTerm(name, query, terms)
        )!
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
        messageCount: chat.messageCount,
        matchedViaCharacter: matchedViaCharacter
          ? { id: matchedViaCharacter.id, name: matchedViaCharacter.name }
          : undefined,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      })
    }
  }

  return results
}

/**
 * Search tags
 */
function searchTags(
  matchingTagsWithPriority: Array<{ tag: Tag; priority: MatchPriority }>,
  allCharacters: Character[],
  allChats: ChatMetadata[]
): TagSearchResult[] {
  return matchingTagsWithPriority.map(({ tag, priority }) => {
    const usageCount =
      allCharacters.filter(c => c.tags.includes(tag.id)).length +
      allChats.filter(c => c.tags.includes(tag.id)).length

    return {
      id: tag.id,
      type: 'tags' as const,
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
    }
  })
}

/**
 * Search memories
 */
async function searchMemories(
  repos: UserScopedRepositoryContainer,
  allCharacters: Character[],
  query: string,
  terms: string[],
  matchingTagIds: Set<string>,
  tagPriorityMap: Map<string, MatchPriority>,
  tagMap: Map<string, Tag>,
  charMap: Map<string, Character>
): Promise<MemorySearchResult[]> {
  const results: MemorySearchResult[] = []
  const memoryFields = ['content', 'summary']

  for (const char of allCharacters) {
    const memories = await repos.memories.findByCharacterId(char.id)

    for (const memory of memories) {
      const matchedTagId = memory.tags.find(tagId => matchingTagIds.has(tagId))
      const matchedTag = matchedTagId ? tagMap.get(matchedTagId) : undefined
      const tagMatchPriority = matchedTagId ? (tagPriorityMap.get(matchedTagId) ?? 3) : 3

      let keywordPriority: MatchPriority = 3
      for (const keyword of memory.keywords) {
        const priority = getMatchPriority(keyword, query, terms)
        if (priority < keywordPriority) keywordPriority = priority
      }
      const keywordMatch = keywordPriority < 3

      const match = findMatchedField(
        memory as unknown as Record<string, unknown>,
        query,
        memoryFields,
        terms
      )

      if (match || keywordMatch || matchedTag) {
        let matchedField = match?.field || 'keywords'
        let matchedValue =
          match?.value || memory.keywords.find(k => matchesQueryMultiTerm(k, query, terms)) || ''
        let snippet = match ? createSnippet(match.value, query) : memory.summary

        let matchPriority: MatchPriority = 3
        if (match) matchPriority = Math.min(matchPriority, match.priority) as MatchPriority
        if (keywordMatch) matchPriority = Math.min(matchPriority, keywordPriority) as MatchPriority
        if (matchedTag)
          matchPriority = Math.min(matchPriority, tagMatchPriority) as MatchPriority

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

  return results
}

/**
 * Limit and sort results with minimum guarantees per type
 */
function limitAndSortResults(
  results: SearchResult[],
  limit: number,
  lowerQuery: string,
  requestedTypes: SearchType[]
): SearchResult[] {
  // Group results by type
  const resultsByType: Record<SearchType, SearchResult[]> = {
    characters: [],
    chats: [],
    tags: [],
    memories: [],
  }

  for (const result of results) {
    resultsByType[result.type].push(result)
  }

  // Sort each type's results
  const sortWithinType = createWithinTypeSorter(lowerQuery)
  for (const type of Object.keys(resultsByType) as SearchType[]) {
    resultsByType[type].sort(sortWithinType)
  }

  // Build final results with minimum guarantees per type
  const limitedResults: SearchResult[] = []
  const takenPerType: Record<SearchType, number> = {
    characters: 0,
    chats: 0,
    tags: 0,
    memories: 0,
  }

  const typeOrder: SearchType[] = ['characters', 'chats', 'tags', 'memories']

  // First pass: ensure minimums
  for (const type of typeOrder) {
    if (!requestedTypes.includes(type)) continue
    const available = resultsByType[type]
    const minForType = Math.min(MIN_PER_TYPE[type], available.length)

    for (let i = 0; i < minForType && limitedResults.length < limit; i++) {
      limitedResults.push(available[i])
      takenPerType[type]++
    }
  }

  // Second pass: fill remaining slots with best remaining results
  if (limitedResults.length < limit) {
    const remaining: SearchResult[] = []
    for (const type of typeOrder) {
      if (!requestedTypes.includes(type)) continue
      const available = resultsByType[type]
      for (let i = takenPerType[type]; i < available.length; i++) {
        remaining.push(available[i])
      }
    }

    remaining.sort((a, b) => {
      const typeDiff = TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]
      if (typeDiff !== 0) return typeDiff
      return sortWithinType(a, b)
    })

    for (const result of remaining) {
      if (limitedResults.length >= limit) break
      limitedResults.push(result)
    }
  }

  // Final sort: group by type in priority order
  limitedResults.sort((a, b) => {
    const typeDiff = TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]
    if (typeDiff !== 0) return typeDiff
    return sortWithinType(a, b)
  })

  return limitedResults
}
