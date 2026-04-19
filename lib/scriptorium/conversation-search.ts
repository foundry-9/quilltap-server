/**
 * Conversation Chunk Search
 * Project Scriptorium Phase 2
 *
 * Semantic search across conversation chunks using cosine similarity
 * on pre-computed embeddings.
 */

import { cosineSimilarity } from '@/lib/embedding/embedding-service'
import { getRepositories } from '@/lib/repositories/factory'
import { createServiceLogger } from '@/lib/logging/create-logger'

const logger = createServiceLogger('ConversationSearch')

export interface ConversationSearchResult {
  chunkId: string
  chatId: string
  conversationTitle: string
  interchangeIndex: number
  content: string
  participantNames: string[]
  score: number
}

export interface ConversationSearchOptions {
  /** Character ID to scope search to conversations this character participates in */
  characterId: string
  limit?: number
  minScore?: number
}

/**
 * Search conversation chunks by semantic similarity.
 *
 * Scoped to conversations the given character participates in.
 * Loads embedded chunks for those conversations, computes cosine similarity
 * against the query embedding, and returns ranked results with conversation titles.
 */
export async function searchConversationChunks(
  queryEmbedding: Float32Array,
  options: ConversationSearchOptions
): Promise<ConversationSearchResult[]> {
  const repos = getRepositories()
  const limit = options.limit || 10
  const minScore = options.minScore || 0.3

  logger.debug('Searching conversation chunks', { characterId: options.characterId, limit, minScore })

  // Find chats this character participates in
  const characterChats = await repos.chats.findByCharacterId(options.characterId)
  const characterChatIds = new Set(characterChats.map(c => c.id))

  if (characterChatIds.size === 0) {
    logger.debug('Character has no conversations', { characterId: options.characterId })
    return []
  }

  // Load all chunks that have embeddings, then filter to character's chats
  const allChunks = (await repos.conversationChunks.findAllWithEmbeddings())
    .filter(chunk => characterChatIds.has(chunk.chatId))

  if (allChunks.length === 0) {
    logger.debug('No embedded conversation chunks found')
    return []
  }

  logger.debug('Loaded embedded chunks for search', { chunkCount: allChunks.length })

  // Compute cosine similarity for each chunk
  const scored = allChunks
    .map(chunk => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding!),
    }))
    .filter(item => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  if (scored.length === 0) {
    logger.debug('No conversation chunks above minimum score', { minScore })
    return []
  }

  // Build title map from already-loaded character chats
  const chatTitles = new Map<string, string>()
  for (const chat of characterChats) {
    chatTitles.set(chat.id, chat.title)
  }

  const results: ConversationSearchResult[] = scored.map(({ chunk, score }) => ({
    chunkId: chunk.id,
    chatId: chunk.chatId,
    conversationTitle: chatTitles.get(chunk.chatId) || 'Untitled',
    interchangeIndex: chunk.interchangeIndex,
    content: chunk.content,
    participantNames: chunk.participantNames,
    score,
  }))

  logger.debug('Conversation chunk search completed', {
    resultsCount: results.length,
    topScore: results[0]?.score,
  })

  return results
}
