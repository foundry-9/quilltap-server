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
import { searchDocumentChunks, type DocumentSearchResult } from '@/lib/mount-index/document-search'
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
  projectId?: string
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
      sources = ['memories', 'conversations', 'documents', 'knowledge'],
      limit = 10,
      minImportance = 0,
    } = input

    const searchMemories = sources.includes('memories')
    const searchConversations = sources.includes('conversations')
    const searchDocuments = sources.includes('documents')
    const searchKnowledge = sources.includes('knowledge')

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
              applyLiteralPhraseBoost: true,
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
          {
            characterId: context.characterId,
            limit,
            minScore: 0.3,
            query,
            applyLiteralPhraseBoost: true,
          }
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
      } catch (error) {
        logger.warn('Conversation search failed, continuing with other sources', {
          context: 'search-scriptorium-handler',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Search documents if requested. We defer pushing document hits into
    // `results` until after the knowledge branch has run — when a character
    // vault is linked to the active project, the same chunk surfaces here AND
    // in the knowledge branch (scoped to that vault's `Knowledge/` folder).
    // We drop the duplicate from this side so the knowledge-labeled row wins.
    let documentRows: DocumentSearchResult[] = []
    if (searchDocuments) {
      try {
        const embeddingResult = await generateEmbeddingForUser(
          query,
          context.userId,
          context.embeddingProfileId
        )

        documentRows = await searchDocumentChunks(
          embeddingResult.embedding,
          {
            projectId: context.projectId,
            limit,
            minScore: 0.3,
            query,
            applyLiteralPhraseBoost: true,
          }
        )
      } catch (error) {
        logger.warn('Document search failed, continuing with other sources', {
          context: 'search-scriptorium-handler',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Search the responding character's own knowledge base if requested.
    // Scoped to the Knowledge/ folder of their character vault. Silent
    // no-op when the character has no vault or no Knowledge/ files.
    const knowledgeChunkIds = new Set<string>()
    if (searchKnowledge) {
      try {
        const repos = getRepositories()
        const character = await repos.characters.findById(context.characterId)

        if (
          character &&
          character.userId === context.userId &&
          character.characterDocumentMountPointId
        ) {
          const embeddingResult = await generateEmbeddingForUser(
            query,
            context.userId,
            context.embeddingProfileId
          )

          const knowledgeResults = await searchDocumentChunks(
            embeddingResult.embedding,
            {
              mountPointIds: [character.characterDocumentMountPointId],
              pathPrefix: 'Knowledge/',
              limit,
              minScore: 0.3,
              query,
              applyLiteralPhraseBoost: true,
            }
          )

          for (const kr of knowledgeResults) {
            knowledgeChunkIds.add(kr.chunkId)
            results.push({
              content: kr.content.length > 500
                ? kr.content.substring(0, 500) + '...'
                : kr.content,
              sourceType: 'knowledge',
              relevanceScore: kr.score,
              metadata: {
                mountPointName: kr.mountPointName,
                fileName: kr.fileName,
                filePath: kr.relativePath,
                chunkIndex: kr.chunkIndex,
                headingContext: kr.headingContext ?? undefined,
              },
            })
          }
        }
      } catch (error) {
        logger.warn('Knowledge search failed, continuing with other sources', {
          context: 'search-scriptorium-handler',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Now push deferred document rows, skipping any chunk that already came
    // through as a knowledge hit (the knowledge label is more specific and
    // should win the slot).
    let documentDuplicatesDropped = 0
    for (const dr of documentRows) {
      if (knowledgeChunkIds.has(dr.chunkId)) {
        documentDuplicatesDropped++
        continue
      }
      results.push({
        content: dr.content.length > 500
          ? dr.content.substring(0, 500) + '...'
          : dr.content,
        sourceType: 'document',
        relevanceScore: dr.score,
        metadata: {
          mountPointName: dr.mountPointName,
          fileName: dr.fileName,
          filePath: dr.relativePath,
          chunkIndex: dr.chunkIndex,
          headingContext: dr.headingContext ?? undefined,
        },
      })
    }
    if (documentDuplicatesDropped > 0) {
      logger.debug('Dropped document hits also surfaced as knowledge', {
        context: 'search-scriptorium-handler',
        droppedCount: documentDuplicatesDropped,
      })
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
      documentSources: limitedResults.filter(r => r.sourceType === 'document').length,
      knowledgeSources: limitedResults.filter(r => r.sourceType === 'knowledge').length,
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
    } else if (result.sourceType === 'conversation') {
      return `[Result ${index + 1} - Conversation] (Relevance: ${(result.relevanceScore * 100).toFixed(0)}%, Chat: ${result.metadata.conversationTitle || 'Untitled'})
Conversation ID: ${result.metadata.conversationId}
Interchange: ${result.metadata.interchangeIndex}
Participants: ${result.metadata.participantNames?.join(', ') || 'Unknown'}
Content: ${result.content}`
    } else if (result.sourceType === 'knowledge') {
      const heading = result.metadata.headingContext ? `, Section: ${result.metadata.headingContext}` : ''
      const path = result.metadata.filePath || result.metadata.fileName || 'Unknown'
      const mount = result.metadata.mountPointName || 'Unknown'
      return `[Result ${index + 1} - Knowledge] (Relevance: ${(result.relevanceScore * 100).toFixed(0)}%, Vault: ${mount}${heading})
File: ${path}
Content: ${result.content}
Re-read with: doc_read_file(scope=document_store, mount_point="${mount}", path="${path}")`
    } else {
      const heading = result.metadata.headingContext ? `, Section: ${result.metadata.headingContext}` : ''
      return `[Result ${index + 1} - Document] (Relevance: ${(result.relevanceScore * 100).toFixed(0)}%, Source: ${result.metadata.mountPointName || 'Unknown'}${heading})
File: ${result.metadata.filePath || result.metadata.fileName || 'Unknown'}
Content: ${result.content}`
    }
  })

  return `Found ${results.length} results:\n\n${formatted.join('\n\n')}`
}
