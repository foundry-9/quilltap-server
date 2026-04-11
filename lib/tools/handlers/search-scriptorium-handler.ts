/**
 * Search Scriptorium Tool Handler
 * Project Scriptorium Phase 2
 *
 * Executes unified search across memories and conversation chunks,
 * merging and ranking results by relevance.
 */

import { searchMemoriesSemantic } from '@/lib/memory/memory-service'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { searchConversationChunks } from '@/lib/scriptorium/conversation-search'
import { getRepositories } from '@/lib/repositories/factory'
import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  SearchScriptoriumToolInput,
  SearchScriptoriumToolOutput,
  SearchScriptoriumResult,
  validateSearchScriptoriumInput,
} from '../search-scriptorium-tool'

const logger = createServiceLogger('SearchScriptoriumHandler')

/**
 * Context required for search scriptorium execution
 */
export interface SearchScriptoriumToolContext {
  userId: string
  characterId: string
  embeddingProfileId?: string
}

/**
 * Execute the search scriptorium tool
 */
export async function executeSearchScriptoriumTool(
  input: unknown,
  context: SearchScriptoriumToolContext
): Promise<SearchScriptoriumToolOutput> {
  try {
    // Validate input
    if (!validateSearchScriptoriumInput(input)) {
      logger.warn('Search scriptorium tool validation failed', {
        context: 'search-scriptorium-handler',
        userId: context.userId,
        characterId: context.characterId,
        input,
      })
      return {
        success: false,
        error: 'Invalid input: query is required and must be a non-empty string',
        totalFound: 0,
        query: '',
      }
    }

    const {
      query,
      sources = ['memories', 'conversations'],
      limit = 10,
      minImportance = 0,
    } = input

    const searchMemories = sources.includes('memories')
    const searchConversations = sources.includes('conversations')

    logger.debug('Executing search scriptorium', {
      context: 'search-scriptorium-handler',
      userId: context.userId,
      characterId: context.characterId,
      query: query.substring(0, 100),
      sources,
      limit,
      searchMemories,
      searchConversations,
    })

    const results: SearchScriptoriumResult[] = []

    // Search memories if requested
    if (searchMemories) {
      try {
        // Verify character exists and belongs to user
        const repos = getRepositories()
        const character = await repos.characters.findById(context.characterId)

        if (character && character.userId === context.userId) {
          const memoryResults = await searchMemoriesSemantic(
            context.characterId,
            query,
            {
              userId: context.userId,
              embeddingProfileId: context.embeddingProfileId,
              limit,
              minImportance,
            }
          )

          for (const mr of memoryResults) {
            results.push({
              content: mr.memory.content,
              sourceType: 'memory',
              relevanceScore: mr.score,
              metadata: {
                memoryId: mr.memory.id,
                summary: mr.memory.summary,
                importance: mr.memory.importance,
                effectiveWeight: mr.effectiveWeight,
                createdAt: mr.memory.createdAt,
                source: mr.memory.source,
              },
            })
          }

          logger.debug('Memory search completed', {
            context: 'search-scriptorium-handler',
            memoryResultCount: memoryResults.length,
          })
        }
      } catch (error) {
        logger.warn('Memory search failed, continuing with other sources', {
          context: 'search-scriptorium-handler',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Search conversations if requested
    if (searchConversations) {
      try {
        // Generate embedding for the query
        const embeddingResult = await generateEmbeddingForUser(
          query,
          context.userId,
          context.embeddingProfileId
        )

        const conversationResults = await searchConversationChunks(
          embeddingResult.embedding,
          { characterId: context.characterId, limit, minScore: 0.3 }
        )

        for (const cr of conversationResults) {
          results.push({
            content: cr.content.length > 500
              ? cr.content.substring(0, 500) + '...'
              : cr.content,
            sourceType: 'conversation',
            relevanceScore: cr.score,
            metadata: {
              conversationId: cr.chatId,
              interchangeIndex: cr.interchangeIndex,
              conversationTitle: cr.conversationTitle,
              participantNames: cr.participantNames,
            },
          })
        }

        logger.debug('Conversation search completed', {
          context: 'search-scriptorium-handler',
          conversationResultCount: conversationResults.length,
        })
      } catch (error) {
        logger.warn('Conversation search failed, continuing with other sources', {
          context: 'search-scriptorium-handler',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Sort all results by relevance score and limit
    results.sort((a, b) => b.relevanceScore - a.relevanceScore)
    const limitedResults = results.slice(0, limit)

    logger.info('Search scriptorium completed', {
      context: 'search-scriptorium-handler',
      userId: context.userId,
      query: query.substring(0, 100),
      totalFound: limitedResults.length,
      memorySources: limitedResults.filter(r => r.sourceType === 'memory').length,
      conversationSources: limitedResults.filter(r => r.sourceType === 'conversation').length,
    })

    return {
      success: true,
      results: limitedResults,
      totalFound: limitedResults.length,
      query,
    }
  } catch (error) {
    logger.error('Search scriptorium tool execution failed', {
      context: 'search-scriptorium-handler',
      userId: context.userId,
      characterId: context.characterId,
    }, error instanceof Error ? error : undefined)

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during search',
      totalFound: 0,
      query: typeof input === 'object' && input !== null && 'query' in input
        ? String((input as Record<string, unknown>).query)
        : '',
    }
  }
}

/**
 * Format search scriptorium results for inclusion in conversation context
 */
export function formatSearchScriptoriumResults(results: SearchScriptoriumResult[]): string {
  if (results.length === 0) {
    return 'No relevant results found.'
  }

  const formatted = results.map((result, index) => {
    if (result.sourceType === 'memory') {
      const importanceLabel = (result.metadata.importance ?? 0) >= 0.7 ? 'High' :
        (result.metadata.importance ?? 0) >= 0.4 ? 'Medium' : 'Low'

      return `[Result ${index + 1} - Memory] (Importance: ${importanceLabel}, Relevance: ${(result.relevanceScore * 100).toFixed(0)}%)
Summary: ${result.metadata.summary || 'No summary'}
Details: ${result.content}`
    } else {
      return `[Result ${index + 1} - Conversation] (Relevance: ${(result.relevanceScore * 100).toFixed(0)}%, Chat: ${result.metadata.conversationTitle || 'Untitled'})
Conversation ID: ${result.metadata.conversationId}
Interchange: ${result.metadata.interchangeIndex}
Participants: ${result.metadata.participantNames?.join(', ') || 'Unknown'}
Content: ${result.content}`
    }
  })

  return `Found ${results.length} results:\n\n${formatted.join('\n\n')}`
}
