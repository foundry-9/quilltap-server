// Search component types

export type SearchType = 'chats' | 'characters' | 'tags' | 'memories' | 'messages'

// Match priority: 0=exact phrase, 1=all terms AND, 2=single term match
export type MatchPriority = 0 | 1 | 2

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

export interface ChatSearchResult extends BaseSearchResult {
  type: 'chats'
  characterNames?: string[]
  messageCount?: number
  matchedViaCharacter?: {
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

export interface MessageSearchResult extends BaseSearchResult {
  type: 'messages'
  chatId: string
  chatTitle: string
  characterNames?: string[]
  role: 'USER' | 'ASSISTANT'
  messageId: string
}

export type SearchResult = ChatSearchResult | CharacterSearchResult | TagSearchResult | MemorySearchResult | MessageSearchResult

export interface SearchResponse {
  results: SearchResult[]
  totalCount: number
  query: string
  types: SearchType[]
  hasMore: boolean
  /** Total count of results per type (before pagination) */
  countsByType?: Partial<Record<SearchType, number>>
}

// Type icons for display
export const TYPE_ICONS: Record<SearchType, string> = {
  chats: '💬',
  characters: '🎭',
  tags: '🏷️',
  memories: '🧠',
  messages: '📝',
}

export const TYPE_LABELS: Record<SearchType, string> = {
  chats: 'Chat',
  characters: 'Character',
  tags: 'Tag',
  memories: 'Memory',
  messages: 'Message',
}

export const TYPE_LABELS_PLURAL: Record<SearchType, string> = {
  chats: 'Chats',
  characters: 'Characters',
  tags: 'Tags',
  memories: 'Memories',
  messages: 'Messages',
}
