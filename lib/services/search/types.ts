/**
 * Search Types
 *
 * Type definitions for global search functionality.
 */

import type { MatchPriority } from './search-utils'

/**
 * Valid entity types for search
 */
export const VALID_SEARCH_TYPES = ['chats', 'characters', 'tags', 'memories'] as const
export type SearchType = typeof VALID_SEARCH_TYPES[number]

/**
 * Base search result interface
 */
export interface BaseSearchResult {
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
  matchPriority: MatchPriority
  createdAt: string
  updatedAt: string
}

/**
 * Chat search result
 */
export interface ChatSearchResult extends BaseSearchResult {
  type: 'chats'
  characterNames?: string[]
  messageCount?: number
  matchedViaCharacter?: {
    id: string
    name: string
  }
}

/**
 * Character search result
 */
export interface CharacterSearchResult extends BaseSearchResult {
  type: 'characters'
  title?: string | null
  avatarUrl?: string | null
  isFavorite?: boolean
}

/**
 * Tag search result
 */
export interface TagSearchResult extends BaseSearchResult {
  type: 'tags'
  usageCount: number
  quickHide: boolean
}

/**
 * Memory search result
 */
export interface MemorySearchResult extends BaseSearchResult {
  type: 'memories'
  characterId: string
  characterName?: string
  importance: number
  source: 'AUTO' | 'MANUAL'
}

/**
 * Union type for all search results
 */
export type SearchResult =
  | ChatSearchResult
  | CharacterSearchResult
  | TagSearchResult
  | MemorySearchResult

/**
 * Global search response
 */
export interface GlobalSearchResponse {
  results: SearchResult[]
  totalCount: number
  query: string
  types: SearchType[]
}

/**
 * Search options
 */
export interface GlobalSearchOptions {
  /** Search query (min 2 characters) */
  query: string
  /** Types to search (defaults to all) */
  types?: SearchType[]
  /** Maximum results to return (defaults to 40, max 100) */
  limit?: number
}
