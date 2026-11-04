/**
 * Search Scriptorium Tool Handler
 * Project Scriptorium Phase 2
 *
 * Executes unified search across memories and conversation chunks,
 * merging and ranking results by relevance.
 */

import { searchMemories as searchCharacterMemories } from '@/lib/memory/recall/search'
import { stampAccessed } from '@/lib/memory/recall/deliver'
import { filterImportance, importanceBand, TOOL_MIN_IMPORTANCE } from '@/lib/memory/scoring'
import { zonedDateStamp, zonedDayBoundsIso } from '@/lib/memory/time/calendar'
import { refreshMemoryTimeZone } from '@/lib/memory/time/calendar-refresh'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { searchConversationChunks } from '@/lib/scriptorium/conversation-search'
import { findChatsInWindow } from '@/lib/scriptorium/chat-window'
import { isNarrowToolWindow } from '@/lib/memory/recall/score'
import { searchDocumentChunks, type DocumentSearchResult } from '@/lib/mount-index/document-search'
import { buildDocStoreUriResolver } from '@/lib/doc-edit/uri-producers'
import { LITERAL_BOOST_GLOBAL } from '@/lib/embedding/literal-boost'
import { bucketMounts } from '@/lib/mount-index/reach'
import {
  resolveTieredMountPool,
  flattenTierPool,
  type TieredMountPool,
} from '@/lib/mount-index/tiered-mount-pool'
import { getRepositories } from '@/lib/repositories/factory'
import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  SearchScriptoriumToolInput,
  SearchScriptoriumToolOutput,
  SearchScriptoriumResult,
  SearchWindowCensus,
  validateSearchScriptoriumInput,
} from '../search-scriptorium-tool'
import type { ChatMetadata } from '@/lib/schemas/types'

const logger = createServiceLogger('SearchScriptoriumHandler')

type SearchSource = NonNullable<SearchScriptoriumToolInput['sources']>[number]

const ALL_SOURCES: SearchSource[] = ['memories', 'conversations', 'documents', 'knowledge']

/** How many of the window's conversations the census lists by name. */
const CENSUS_MAX_CONVERSATIONS = 10

/**
 * Context required for search scriptorium execution
 */
export interface SearchScriptoriumToolContext {
  userId: string
  /** Acting character — absent on the operator surface (Brahma Console). */
  characterId?: string
  embeddingProfileId?: string
  projectId?: string
  /**
   * Operator surface (Brahma Console): character-less, memory-free. When set,
   * memory search is forced off, documents/knowledge reach every enabled store,
   * and conversations are searched operator-wide (all the user's chats).
   */
  operatorSurface?: boolean
  /**
   * A pre-built pool — "what this chat could see" before the chat exists (the
   * Scenario Builder; `resolveScenarioBuilderMountPool`). When set, the pool is
   * used as-is instead of resolved, the cast vaults (participant tier) are
   * searched, and only `documents` / `knowledge` run: memories and
   * conversations are forced off. Never combined with `operatorSurface`.
   */
  mountPool?: TieredMountPool
  /** The chat the search runs in — left out of the window census. */
  chatId?: string
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
    const parsed = validateSearchScriptoriumInput(input)
    if (!parsed) {
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
      scope = 'all',
      limit = 10,
      minImportance = TOOL_MIN_IMPORTANCE,
      since,
      until,
      aboutCharacter,
    } = parsed

    // Time filters (episodic recall): date-only bounds widen to full LOCAL
    // days on the memory calendar (bug 212), the calendar memories are dated
    // on — never UTC days. Applied to memories via occurredAt ?? createdAt
    // and to conversation hits via the source chat's timestamps.
    const memoryTimeZone = since || until ? await refreshMemoryTimeZone() : null
    const sinceIso = since
      ? (since.length === 10 ? zonedDayBoundsIso(since, memoryTimeZone!)?.from ?? `${since}T00:00:00.000Z` : since)
      : null
    const untilIso = until
      ? (until.length === 10 ? zonedDayBoundsIso(until, memoryTimeZone!)?.to ?? `${until}T23:59:59.999Z` : until)
      : null
    const timeWindow =
      sinceIso || untilIso
        ? {
            from: sinceIso ?? '0000-01-01T00:00:00.000Z',
            to: untilIso ?? '9999-12-31T23:59:59.999Z',
          }
        : null

    const repos = getRepositories()

    // A dated search with no explicit sources leaves documents out: they carry
    // no dates, and would crowd dated hits out of the cross-source cut. The
    // Scenario Builder (pre-built pool) keeps its own default; the operator
    // surface has no memories, so its dated default is conversations alone.
    const dated = !!(since || until)
    const defaultedSources = !parsed.sources && dated && !context.mountPool
    const sources: SearchSource[] = parsed.sources
      ?? (defaultedSources
        ? (context.operatorSurface ? ['conversations'] : ['memories', 'conversations'])
        : ALL_SOURCES)

    // Operator surface (Brahma Console): no character, no memories. Memory
    // search is forced off here defensively even if a caller somehow requests
    // it — the console never reads anyone's commonplace book.
    const operatorWide = !!context.operatorSurface && !context.mountPool
    // A pre-built pool is a documents-only surface (Scenario Builder): its
    // schema never offers memories or conversations, and the handler enforces
    // the same exclusion defensively.
    const prebuiltPool = context.mountPool ?? null
    const searchMemories = sources.includes('memories') && !operatorWide && !prebuiltPool && !!context.characterId
    const searchConversations = sources.includes('conversations') && !prebuiltPool
    const searchDocuments = sources.includes('documents')
    const searchKnowledge = sources.includes('knowledge')

    // Window-first: the period's conversations, read once, scope the chunk
    // search and feed the census. A narrow window is its own relevance filter.
    const narrowWindow = isNarrowToolWindow(timeWindow)
    const windowChats: ChatMetadata[] | null =
      timeWindow && (searchMemories || searchConversations)
        ? await findChatsInWindow({
            characterId: operatorWide ? undefined : context.characterId,
            userId: context.userId,
            window: timeWindow,
          })
        : null
    let windowMemoryCount: number | null = null

    const results: SearchScriptoriumResult[] = []

    // Resolver for emitting a canonical qtap:// URI per document/knowledge hit
    // (the store name, with UUID fallback — never qtap://self, bug 256).
    // Built once so per-row tagging stays synchronous.
    const docUriResolver = await buildDocStoreUriResolver()

    // Resolve the tri-tier mount pool up front so both the `documents` and
    // `knowledge` branches pick from the same deduped set, scoped by `scope`.
    // Character-vault access is ownership-gated (the one path that checks the
    // character belongs to the calling user); project/global tiers and the
    // pre-provisioning global-null tolerance all live in the shared helper.
    let pool: TieredMountPool = {
      characterMountPointId: null,
      participantMountPointIds: [],
      groupMountPointIds: [],
      projectMountPointIds: [],
      globalMountPointId: null,
    }
    let ownsCharacter = false
    // Operator surface: every enabled store is in scope (no character/project
    // tiers to resolve). Mirrors the doc path resolver's operator override.
    let operatorStoreIds: string[] = []

    if (searchDocuments || searchKnowledge) {
      if (prebuiltPool) {
        pool = prebuiltPool
        // The caller vetted the cast before building the pool.
        ownsCharacter = true
        logger.debug('Search using pre-built mount pool', {
          participants: pool.participantMountPointIds.length,
          groups: pool.groupMountPointIds.length,
          projects: pool.projectMountPointIds.length,
          hasGlobal: !!pool.globalMountPointId,
        })
      } else if (operatorWide) {
        const enabled = await repos.docMountPoints.findEnabled()
        operatorStoreIds = enabled.map((mp) => mp.id)
      } else {
        // The project tier is roster-gated (lib/projects/roster-access.ts).
        pool = await resolveTieredMountPool(
          {
            userId: context.userId,
            characterId: context.characterId,
            projectId: context.projectId,
          },
          { requireOwnership: true, roster: 'gated', enabled: 'ignore' },
        )
        // With ownership gating, a character vault is present only when the
        // calling user owns the character — mirror that for the tier filter below.
        ownsCharacter = !!pool.characterMountPointId
      }
    }

    // Pool for the `documents` source. On the operator surface this is every
    // enabled store; otherwise every store the LLM can see, narrowed by `scope`
    // (`all` is the union; `project` is project-linked stores; `character` is
    // the character's own vault only).
    const buildDocumentsPool = (): string[] =>
      operatorWide
        ? operatorStoreIds
        : flattenTierPool(pool, { scope, includeParticipants: !!prebuiltPool })

    // Tiers for the `knowledge` source — same pools, each constrained to
    // `Knowledge/` paths, with tier-specific literal-phrase boosts so a hit in
    // the closer voice outranks the same hit in the wider pool. The `group` tier
    // is the responding character's group stores (per-character, never the chat).
    const buildKnowledgeTiers = (): Array<{
      tier: 'character' | 'group' | 'project' | 'global'
      mountPointIds: string[]
      boost: number
    }> => {
      // Operator surface: a single all-stores tier (labelled 'global').
      if (operatorWide) {
        return operatorStoreIds.length > 0
          ? [{ tier: 'global', mountPointIds: operatorStoreIds, boost: LITERAL_BOOST_GLOBAL }]
          : []
      }
      // The shared bucketing (`bucketMounts`): tiers nearest first, each
      // with its literal-phrase boost. A pre-built pool's cast vaults stand
      // where the character tier would.
      return bucketMounts(pool, { scope, participantsAsCharacter: !!prebuiltPool })
    }

    // Search memories if requested (never on the operator surface — see above)
    if (searchMemories && context.characterId) {
      const characterId = context.characterId
      try {
        // Verify character exists and belongs to user
        const character = await repos.characters.findById(characterId)

        if (character && character.userId === context.userId) {
          // Census: every memory dated in the window, whatever the query or
          // aboutCharacter matched (all tiers — the tool sees the archive).
          if (timeWindow) {
            windowMemoryCount = (await repos.memories.findIdsInEventWindow(characterId, timeWindow, { hotOnly: false })).length
            logger.debug('Memories in search window', { characterId, count: windowMemoryCount, narrowWindow })
          }

          // Optional about-character filter: resolve the name (or alias) to a
          // character id among the user's characters. An unresolvable name
          // returns no memory hits rather than silently ignoring the filter.
          let aboutCharacterId: string | undefined
          let aboutCharacterUnresolved = false
          if (aboutCharacter) {
            const needle = aboutCharacter.trim().toLowerCase()
            const allCharacters = await repos.characters.findAll()
            const match = allCharacters.find(c => {
              if (c.name.trim().toLowerCase() === needle) return true
              return (c.aliases ?? []).some(a => a.trim().toLowerCase() === needle)
            })
            if (match) {
              aboutCharacterId = match.id
            } else {
              aboutCharacterUnresolved = true
            }
          }

          const memoryResults = aboutCharacterUnresolved
            ? []
            : await searchCharacterMemories(
                characterId,
                query,
                {
                  userId: context.userId,
                  embeddingProfileId: context.embeddingProfileId,
                  limit,
                  minImportance,
                  literalPhrase: true,
                  aboutCharacterId,
                  // Tool path: a plain hard filter on event time (no
                  // recallContext, so no soft fallback — the caller asked
                  // for a window).
                  window: timeWindow,
                  // The drill-down tool sees the archive too: cold shards are
                  // returned labelled, so a character can find what a digest
                  // replaced.
                  includeCold: true,
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
                importance: filterImportance(mr.memory),
                salience: mr.salience,
                createdAt: mr.memory.createdAt,
                source: mr.memory.source,
                archivedLabel: memoryArchivedLabel(mr.memory),
                occurredAt: mr.memory.occurredAt ?? null,
                narrativeTime: mr.memory.narrativeTime ?? null,
                kind: mr.memory.kind ?? 'semantic',
                // The memory's source conversation — drillable via
                // read_conversation.
                conversationId: mr.memory.chatId ?? undefined,
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
    const windowChatIds = windowChats ? new Set(windowChats.map(c => c.id)) : null
    if (searchConversations && windowChatIds && windowChatIds.size === 0) {
      logger.debug('No conversations in search window; chunk search skipped', { characterId: context.characterId })
    } else if (searchConversations) {
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
            // Character surface scopes to the character's chats; the operator
            // surface (no characterId) scopes operator-wide via userId.
            characterId: context.characterId,
            userId: context.userId,
            limit,
            // The window's chats only, scored whole; within a narrow window
            // every chunk is eligible however loosely it matches.
            ...(windowChatIds ? { chatIds: windowChatIds } : {}),
            minScore: narrowWindow ? 0 : 0.3,
            query,
            applyLiteralPhraseBoost: true,
          }
        )
        if (windowChatIds) {
          logger.debug('Window conversation search', { windowChats: windowChatIds.size, hits: conversationResults.length })
        }

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
    // vault is in the documents pool (always, under scope='all' or 'character'),
    // the same chunk surfaces here AND in the knowledge branch (scoped to
    // that vault's `Knowledge/` folder). We drop the duplicate from this side
    // so the knowledge-labeled row wins.
    let documentRows: DocumentSearchResult[] = []
    if (searchDocuments) {
      const documentsPool = buildDocumentsPool()
      if (documentsPool.length > 0) {
        try {
          const embeddingResult = await generateEmbeddingForUser(
            query,
            context.userId,
            context.embeddingProfileId
          )

          documentRows = await searchDocumentChunks(
            embeddingResult.embedding,
            {
              mountPointIds: documentsPool,
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
    }

    // Search the Knowledge/ tiers if requested. The same three pools as the
    // documents branch, narrowed by `scope`, but each tier is path-filtered
    // to `Knowledge/` and passes a distinct literalBoostFraction so a
    // verbatim hit in the character's own vault outranks the same hit in
    // the project pool, which in turn outranks the same hit in Quilltap
    // General. Branches are independent — any one can silently no-op (no
    // vault, no project links, not provisioned yet) without disturbing the
    // others. Character-vault access requires character ownership.
    const knowledgeChunkIds = new Set<string>()
    if (searchKnowledge) {
      const tiers = buildKnowledgeTiers()
      const tiersAllowed = tiers.filter(t => t.tier !== 'character' || ownsCharacter)

      if (tiersAllowed.length > 0) {
        try {
          const embeddingResult = await generateEmbeddingForUser(
            query,
            context.userId,
            context.embeddingProfileId
          )

          await Promise.all(
            tiersAllowed.map(async ({ tier, mountPointIds, boost }) => {
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
                      uri: docUriResolver.uriForMount(kr.mountPointName, kr.mountPointId, kr.relativePath),
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
    for (const dr of documentRows) {
      if (knowledgeChunkIds.has(dr.chunkId)) {
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
          uri: docUriResolver.uriForMount(dr.mountPointName, dr.mountPointId, dr.relativePath),
          chunkIndex: dr.chunkIndex,
          headingContext: dr.headingContext ?? undefined,
        },
      })
    }

    // Sort all results by relevance score and limit
    results.sort((a, b) => b.relevanceScore - a.relevanceScore)
    const limitedResults = results.slice(0, limit)

    // Only the memories that survived the cross-source cut reach the model;
    // those, and only those, count as accessed.
    if (context.characterId) {
      const returnedMemoryIds = limitedResults
        .filter(r => r.sourceType === 'memory')
        .map(r => r.metadata.memoryId)
        .filter((id): id is string => typeof id === 'string')
      stampAccessed(context.characterId, returnedMemoryIds)
    }

    const windowCensus: SearchWindowCensus | undefined = windowChats
      ? buildWindowCensus(windowChats, {
          since: since ?? null,
          until: until ?? null,
          memoryCount: windowMemoryCount,
          excludeChatId: context.chatId,
          timeZone: memoryTimeZone,
        })
      : undefined

    logger.info('Search scriptorium completed', {
      context: 'search-scriptorium-handler',
      userId: context.userId,
      query: query.substring(0, 100),
      scope,
      defaultedSources,
      ...(windowCensus
        ? { windowCensus: { memoryCount: windowCensus.memoryCount, conversations: windowCensus.conversations.length + windowCensus.moreConversations } }
        : {}),
      totalFound: limitedResults.length,
      memorySources: limitedResults.filter(r => r.sourceType === 'memory').length,
      conversationSources: limitedResults.filter(r => r.sourceType === 'conversation').length,
      documentSources: limitedResults.filter(r => r.sourceType === 'document').length,
      knowledgeSources: limitedResults.filter(r => r.sourceType === 'knowledge').length,
      knowledgeCharacter: limitedResults.filter(r => r.sourceType === 'knowledge' && r.metadata.knowledgeTier === 'character').length,
      knowledgeGroup: limitedResults.filter(r => r.sourceType === 'knowledge' && r.metadata.knowledgeTier === 'group').length,
      knowledgeProject: limitedResults.filter(r => r.sourceType === 'knowledge' && r.metadata.knowledgeTier === 'project').length,
      knowledgeGlobal: limitedResults.filter(r => r.sourceType === 'knowledge' && r.metadata.knowledgeTier === 'global').length,
    })

    return {
      success: true,
      results: limitedResults,
      totalFound: limitedResults.length,
      query,
      ...(windowCensus ? { windowCensus } : {}),
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
 * The window census from the period's chats (newest first): the current chat
 * left out, the first {@link CENSUS_MAX_CONVERSATIONS} listed, the rest counted.
 */
export function buildWindowCensus(
  windowChats: readonly ChatMetadata[],
  opts: {
    since: string | null
    until: string | null
    memoryCount: number | null
    excludeChatId?: string
    /** The memory calendar's zone; dates are UTC without it. */
    timeZone?: string | null
  },
): SearchWindowCensus {
  const localDate = (iso: string): string => {
    const ms = Date.parse(iso)
    if (!Number.isFinite(ms)) return iso.slice(0, 10)
    return opts.timeZone ? zonedDateStamp(ms, opts.timeZone) : new Date(ms).toISOString().slice(0, 10)
  }
  const others = windowChats.filter(c => c.id !== opts.excludeChatId)
  return {
    since: opts.since,
    until: opts.until,
    memoryCount: opts.memoryCount,
    conversations: others.slice(0, CENSUS_MAX_CONVERSATIONS).map(c => ({
      id: c.id,
      title: c.title || 'Untitled',
      firstMessageAt: c.createdAt,
      lastMessageAt: c.lastMessageAt ?? null,
      date: localDate(c.createdAt),
    })),
    moreConversations: Math.max(0, others.length - CENSUS_MAX_CONVERSATIONS),
  }
}

/**
 * Label for a cold-tier memory in `search` results: `(archived — superseded by
 * <digest id>)` when a digest replaced it, `(archived)` otherwise. Hot rows get
 * no label.
 */
export function memoryArchivedLabel(memory: { tier?: string; supersededById?: string | null }): string | undefined {
  if (memory.tier !== 'cold') return undefined
  return memory.supersededById
    ? `(archived — superseded by ${memory.supersededById})`
    : '(archived)'
}

/** A bound as the caller gave it, shown as a calendar date. */
function censusDate(bound: string | null, fallback: string): string {
  return bound ? bound.slice(0, 10) : fallback
}

/** "between X and Y" for a census window, in plain words. */
function censusPeriod(census: SearchWindowCensus): string {
  if (census.since && census.until) {
    return census.since.slice(0, 10) === census.until.slice(0, 10)
      ? `on ${censusDate(census.since, '')}`
      : `between ${censusDate(census.since, '')} and ${censusDate(census.until, '')}`
  }
  if (census.since) return `between ${censusDate(census.since, '')} and today`
  return `up to ${censusDate(census.until, 'today')}`
}

/** The census's conversation list, one line each, with the overflow. */
function censusConversationLines(census: SearchWindowCensus): string[] {
  const lines = census.conversations.map(c => `- ${c.title} (${c.date}) — \`${c.id}\``)
  if (census.moreConversations > 0) lines.push(`- …and ${census.moreConversations} more`)
  return lines
}

/** What an empty search means, given the window census (or none). */
function formatEmptySearch(query: string | undefined, census: SearchWindowCensus | undefined): string {
  const quoted = query ? `"${query}"` : 'your search'
  if (!census) {
    return `Nothing matched ${quoted}. An empty search is not proof that nothing happened: try other words, or pass since/until if you are asking about a particular time.`
  }
  const period = censusPeriod(census)
  const memories = census.memoryCount ?? 0
  const hasConversations = census.conversations.length > 0 || census.moreConversations > 0
  if (memories === 0 && !hasConversations) {
    return census.memoryCount === null
      ? `There are no conversations ${period}.`
      : `You hold no memories dated ${period}, and took part in no conversations in that period.`
  }
  const lines = [`Nothing matched ${quoted} — but that is not the same as having no record of the period.`]
  const memoryClause = census.memoryCount === null
    ? null
    : `you hold ${memories} ${memories === 1 ? 'memory' : 'memories'}`
  const conversationClause = census.memoryCount === null ? 'these conversations took place' : 'you took part in these conversations'
  const head = period.charAt(0).toUpperCase() + period.slice(1)
  if (hasConversations) {
    lines.push(`${head} ${memoryClause ? `${memoryClause}, and ` : ''}${conversationClause}:`)
    lines.push(...censusConversationLines(census))
    lines.push('Read one with read_conversation, or search again with broader words. The date range already narrows the search; the query does not need to name the time.')
  } else {
    lines.push(`${head} ${memoryClause}.`)
    lines.push('Search again with broader words. The date range already narrows the search; the query does not need to name the time.')
  }
  return lines.join('\n')
}

/**
 * Format search scriptorium results for inclusion in conversation context.
 *
 * With `opts.windowCensus`, a result list gains a footer naming the period's
 * conversations, and an empty result says whether nothing matched the words
 * or nothing happened in the period. Without opts, results print unchanged.
 */
export function formatSearchScriptoriumResults(
  results: SearchScriptoriumResult[],
  opts?: { query: string; windowCensus?: SearchWindowCensus },
): string {
  if (results.length === 0) {
    return formatEmptySearch(opts?.query, opts?.windowCensus)
  }

  const formatted = results.map((result, index) => {
    if (result.sourceType === 'memory') {
      const band = importanceBand(result.metadata.importance ?? 0)
      const importanceLabel = band === 'high' ? 'High' : band === 'medium' ? 'Medium' : 'Low'

      // Episodic spine: surface event time + source conversation so the model
      // can confirm "when" and drill into the transcript.
      const whenParts: string[] = []
      if (result.metadata.occurredAt) whenParts.push(`When: ${result.metadata.occurredAt.slice(0, 10)}`)
      if (result.metadata.narrativeTime) whenParts.push(`Story time: ${result.metadata.narrativeTime}`)
      const whenLine = whenParts.length > 0 ? `\n${whenParts.join(' · ')}` : ''
      const sourceLine = result.metadata.conversationId
        ? `\nSource conversation: ${result.metadata.conversationId} (readable via read_conversation)`
        : ''

      const archived = result.metadata.archivedLabel ? ` ${result.metadata.archivedLabel}` : ''
      return `[Result ${index + 1} - Memory${archived}] (Importance: ${importanceLabel}, Relevance: ${(result.relevanceScore * 100).toFixed(0)}%)
Summary: ${result.metadata.summary || 'No summary'}${whenLine}${sourceLine}
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

  const body = `Found ${results.length} results:\n\n${formatted.join('\n\n')}`
  const census = opts?.windowCensus
  if (!census || census.conversations.length === 0) return body
  const footer = [
    census.memoryCount === null ? 'Conversations during this period:' : 'Conversations you took part in during this period:',
    ...censusConversationLines(census),
    'Read any of them with read_conversation.',
  ].join('\n')
  return `${body}\n\n${footer}`
}
