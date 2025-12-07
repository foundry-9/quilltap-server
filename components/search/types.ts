// Search component types

export type SearchType = 'chats' | 'characters' | 'personas' | 'tags' | 'memories'

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
  createdAt: string
  updatedAt: string
}

export interface ChatSearchResult extends BaseSearchResult {
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

export interface CharacterSearchResult extends BaseSearchResult {
  type: 'characters'
  title?: string | null
  avatarUrl?: string | null
  isFavorite?: boolean
}

export interface PersonaSearchResult extends BaseSearchResult {
  type: 'personas'
  title?: string | null
  avatarUrl?: string | null
}

export interface TagSearchResult extends BaseSearchResult {
  type: 'tags'
  usageCount: number
  quickHide: boolean
}

export interface MemorySearchResult extends BaseSearchResult {
  type: 'memories'
  characterId: string
  characterName?: string
  importance: number
  source: 'AUTO' | 'MANUAL'
}

export type SearchResult = ChatSearchResult | CharacterSearchResult | PersonaSearchResult | TagSearchResult | MemorySearchResult

export interface SearchResponse {
  results: SearchResult[]
  totalCount: number
  query: string
  types: SearchType[]
}

// Type icons for display
export const TYPE_ICONS: Record<SearchType, string> = {
  chats: '💬',
  characters: '🎭',
  personas: '👤',
  tags: '🏷️',
  memories: '🧠',
}

export const TYPE_LABELS: Record<SearchType, string> = {
  chats: 'Chat',
  characters: 'Character',
  personas: 'Persona',
  tags: 'Tag',
  memories: 'Memory',
}

export const TYPE_LABELS_PLURAL: Record<SearchType, string> = {
  chats: 'Chats',
  characters: 'Characters',
  personas: 'Personas',
  tags: 'Tags',
  memories: 'Memories',
}
