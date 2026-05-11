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
import {
  LITERAL_BOOST_CHARACTER,
  LITERAL_BOOST_PROJECT,
  LITERAL_BOOST_GLOBAL,
} from '@/lib/embedding/literal-boost'
import { getGeneralMountPointId } from '@/lib/instance-settings'
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

    // Search the three Knowledge/ tiers if requested:
    //   - character: Knowledge/ inside the responding character's vault
    //   - project:   Knowledge/ inside every mount linked to the active project
    //   - global:    Knowledge/ inside the Quilltap General singleton mount
    //
    // Each tier passes a distinct literalBoostFraction so a verbatim hit in
    // the character's own vault outranks the same hit in the project pool,
    // which in turn outranks the same hit in Quilltap General. Branches are
    // independent — any one can silently no-op (no vault, no project links,
    // not provisioned yet) without disturbing the others.
    const knowledgeChunkIds = new Set<string>()
    if (searchKnowledge) {
      const repos = getRepositories()
      let character: Awaited<ReturnType<typeof repos.characters.findById>> = null
      try {
        character = await repos.characters.findById(context.characterId)
      } catch (error) {
        logger.warn('Knowledge search: character lookup failed', {
          context: 'search-scriptorium-handler',
          error: error instanceof Error ? error.message : String(error),
        })
      }

      const ownsCharacter = !!character && character.userId === context.userId

      // Resolve project-linked mounts (if a project is in scope).
      let projectMountPointIds: string[] = []
      if (ownsCharacter && context.projectId) {
        try {
          const links = await repos.projectDocMountLinks.findByProjectId(context.projectId)
          projectMountPointIds = links.map(l => l.mountPointId)
        } catch (error) {
          logger.warn('Knowledge search: project mount lookup failed', {
            context: 'search-scriptorium-handler',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // Resolve Quilltap General. Tolerates the pre-migration window where
      // the mount hasn't been provisioned yet.
      let globalMountPointId: string | null = null
      try {
        globalMountPointId = await getGeneralMountPointId()
      } catch (error) {
        logger.debug('Knowledge search: general mount not provisioned yet', {
          context: 'search-scriptorium-handler',
          error: error instanceof Error ? error.message : String(error),
        })
      }

      // Drop the character vault from the project/global lists if it
      // happens to be linked there too — same chunk shouldn't enter the
      // pool through more than one tier.
      const characterMountPointId = ownsCharacter ? character?.characterDocumentMountPointId ?? null : null
      if (characterMountPointId) {
        projectMountPointIds = projectMountPointIds.filter(id => id !== characterMountPointId)
        if (globalMountPointId === characterMountPointId) globalMountPointId = null
      }
      if (globalMountPointId) {
        projectMountPointIds = projectMountPointIds.filter(id => id !== globalMountPointId)
      }

      const tiers: Array<{
        tier: 'character' | 'project' | 'global'
        mountPointIds: string[]
        boost: number
      }> = []
      if (characterMountPointId) {
        tiers.push({ tier: 'character', mountPointIds: [characterMountPointId], boost: LITERAL_BOOST_CHARACTER })
      }
      if (projectMountPointIds.length > 0) {
        tiers.push({ tier: 'project', mountPointIds: projectMountPointIds, boost: LITERAL_BOOST_PROJECT })
      }
      if (globalMountPointId) {
        tiers.push({ tier: 'global', mountPointIds: [globalMountPointId], boost: LITERAL_BOOST_GLOBAL })
      }

      if (ownsCharacter && tiers.length > 0) {
        try {
          // One embedding for all three tiers (plus the documents branch
          // would also reuse it ideally — left as a future tidy).
          const embeddingResult = await generateEmbeddingForUser(
            query,
            context.userId,
            context.embeddingProfileId
          )

          await Promise.all(
            tiers.map(async ({ tier, mountPointIds, boost }) => {
              try {
                const hits = await searchDocumentChunks(embeddingResult.embedding, {
                  mountPointIds,
                  pathPrefix: 'Knowledge/',
                  limit,
                  minScore: 0.3,
                  query,
                  applyLiteralPhraseBoost: true,
                  literalBoostFraction: boost,
                })

                for (const kr of hits) {
                  if (knowledgeChunkIds.has(kr.chunkId)) continue
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
                      knowledgeTier: tier,
                    },
                  })
                }
              } catch (error) {
                logger.warn('Knowledge tier search failed, continuing with other tiers', {
                  context: 'search-scriptorium-handler',
                  tier,
                  error: error instanceof Error ? error.message : String(error),
                })
              }
            })
          )
        } catch (error) {
          logger.warn('Knowledge search embedding failed, skipping all tiers', {
            context: 'search-scriptorium-handler',
            error: error instanceof Error ? error.message : String(error),
          })
        }
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
      knowledgeCharacter: limitedResults.filter(r => r.sourceType === 'knowledge' && r.metadata.knowledgeTier === 'character').length,
      knowledgeProject: limitedResults.filter(r => r.sourceType === 'knowledge' && r.metadata.knowledgeTier === 'project').length,
      knowledgeGlobal: limitedResults.filter(r => r.sourceType === 'knowledge' && r.metadata.knowledgeTier === 'global').length,
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
      const tier = result.metadata.knowledgeTier
        ? ` ${result.metadata.knowledgeTier.charAt(0).toUpperCase()}${result.metadata.knowledgeTier.slice(1)}`
        : ''
      return `[Result ${index + 1} -${tier} Knowledge] (Relevance: ${(result.relevanceScore * 100).toFixed(0)}%, Source: ${mount}${heading})
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
