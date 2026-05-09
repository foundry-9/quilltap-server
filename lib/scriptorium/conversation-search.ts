/**
 * Conversation Chunk Search
 * Project Scriptorium Phase 2
 *
 * Semantic search across conversation chunks using cosine similarity
 * on pre-computed embeddings.
 */

import { cosineSimilarity } from '@/lib/embedding/embedding-service'
import {
  applyLiteralBoost,
  containsLiteralPhrase,
  getLiteralPhrase,
} from '@/lib/embedding/literal-boost'
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
  /**
   * Original query text. Required when `applyLiteralPhraseBoost` is set —
   * the embedding alone can't be substring-matched against chunk content.
   */
  query?: string
  /**
   * When true and the trimmed query is ≥ LITERAL_BOOST_MIN_PHRASE_LENGTH
   * characters, items whose chunk content contains the query verbatim
   * (case-insensitive) get their cosine score boosted halfway to 1.0
   * before minScore filtering and slicing.
   */
  applyLiteralPhraseBoost?: boolean
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

  // Find chats this character participates in
  const characterChats = await repos.chats.findByCharacterId(options.characterId)
  const characterChatIds = new Set(characterChats.map(c => c.id))

  if (characterChatIds.size === 0) {
    return []
  }

  // Load all chunks that have embeddings, then filter to character's chats
  const allChunks = (await repos.conversationChunks.findAllWithEmbeddings())
    .filter(chunk => characterChatIds.has(chunk.chatId))

  if (allChunks.length === 0) {
    return []
  }

  // Compute cosine similarity for each chunk. If literal-boost is on, lift
  // the score of any chunk whose content contains the trimmed query verbatim
  // *before* minScore filtering and the limit slice — that way a buried
  // exact-phrase match can't be silently outranked or sliced off.
  const literalPhrase = options.applyLiteralPhraseBoost
    ? getLiteralPhrase(options.query)
    : null

  let literalHitCount = 0
  const scoredAll = allChunks.map(chunk => {
    const rawScore = cosineSimilarity(queryEmbedding, chunk.embedding!)
    const literalHit = literalPhrase
      ? containsLiteralPhrase(chunk.content, literalPhrase)
      : false
    if (literalHit) literalHitCount++
    return {
      chunk,
      score: literalHit ? applyLiteralBoost(rawScore) : rawScore,
      literalHit,
    }
  })

  const scored = scoredAll
    .filter(item => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  if (scored.length === 0) {
    return []
  }

  if (literalPhrase) {
    logger.debug('Conversation search applied literal-phrase boost', {
      context: 'conversation-search',
      phraseLength: literalPhrase.length,
      literalHitCount,
      returned: scored.length,
    })
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

  return results
}
