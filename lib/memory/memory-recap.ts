/**
 * Memory Recap Service
 *
 * Generates a narrative summary of a character's recent memories to inject
 * at the start of a conversation. Gathers memories by importance tier
 * (high/medium/low), sends them to the cheap LLM for summarization,
 * and returns formatted content for prompt injection.
 *
 * Triggered on:
 * - First message of a new chat (for every character participant)
 * - When a character is added to an existing chat
 */

import { getRepositories } from '@/lib/repositories/factory'
import { formatRelativeAge } from '@/lib/memory/memory-weighting'
import { summarizeMemoryRecap, type UncensoredFallbackOptions } from '@/lib/memory/cheap-llm-tasks'
import {
  searchVaultConversationSummaries,
  renderRelevantConversationsBlock,
  READ_CONVERSATION_CALL_NOTE,
  type VaultConversationMatch,
} from '@/lib/memory/conversation-summary-search'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { Memory } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'

/**
 * Linear ramp from `min` (at `minTokens` of context or less) to `max` (at
 * `maxTokens` or more), rounded. `null`/`undefined` maxContext yields `max`
 * (assume a generous window). Generalized from the old recent-conversations
 * 5→20 ramp so both the recent and the relevant conversation lists can scale
 * independently on the same curve.
 */
export function rampLimit(
  maxContext: number | null | undefined,
  min: number,
  max: number,
  minTokens: number,
  maxTokens: number,
): number {
  if (maxContext == null) return max
  if (maxContext <= minTokens) return min
  if (maxContext >= maxTokens) return max
  const ratio = (maxContext - minTokens) / (maxTokens - minTokens)
  return Math.round(min + ratio * (max - min))
}

// Recent-conversations greeting block: ramp 5→20 over 4K→32K (unchanged).
const RECENT_CONVERSATIONS_MIN = 5
const RECENT_CONVERSATIONS_MAX = 20
const RECENT_CONVERSATIONS_RAMP_MIN_TOKENS = 4000
const RECENT_CONVERSATIONS_RAMP_MAX_TOKENS = 32000

// Recap conversation lists (recent + relevant): each ramps 3→10 over 4K→32K,
// independently. Combined 6–20 entries before dedup.
const RECAP_CONVERSATIONS_MIN = 3
const RECAP_CONVERSATIONS_MAX = 10

export function calculateRecentConversationsLimit(maxContext?: number | null): number {
  return rampLimit(
    maxContext,
    RECENT_CONVERSATIONS_MIN,
    RECENT_CONVERSATIONS_MAX,
    RECENT_CONVERSATIONS_RAMP_MIN_TOKENS,
    RECENT_CONVERSATIONS_RAMP_MAX_TOKENS,
  )
}

export async function buildRecentConversationsBlock(
  characterId: string,
  currentChatId: string | undefined,
  limit: number
): Promise<string> {
  if (limit <= 0) return ''
  const repos = getRepositories()
  const eligible = await repos.chats.findRecentSummarizedByCharacter(characterId, {
    limit,
    excludeChatId: currentChatId,
  })
  if (eligible.length === 0) return ''
  const entries = eligible
    .map(c => `#### ${c.title} (\`${c.id}\`)\n${c.contextSummary}`)
    .join('\n\n')
  return `### Recent Conversations\n\n${entries}`
}

/** Cap an inlined conversation gist so the recap block stays bounded. */
function truncateGist(text: string, maxChars = 280): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  return trimmed.slice(0, maxChars - 1).trimEnd() + '…'
}

export interface ConversationRecallListsParams {
  characterId: string
  /** Current chat id, excluded from both lists. */
  currentChatId: string | undefined
  userId: string
  embeddingProfileId?: string | null
  /** Free-text describing the current moment, drives the relevant list. */
  relevanceQuery: string
  /** Connection profile maxContext, scales both list sizes (3→10 over 4K→32K). */
  maxContext?: number | null
}

/**
 * Build the recap's two conversation lists from the character's vault summaries:
 *
 * - **Relevant Past Conversations** — semantic retrieval over the embedded vault
 *   summaries against the current moment.
 * - **Recent Conversations** — recency-ordered, with a short gist.
 *
 * Each entry surfaces its conversation UUID in backticks; a closing note tells
 * the LLM the UUID is callable via the `read_conversation` tool. A conversation
 * that appears in both lists is kept in the relevant list and dropped from the
 * recent one (so the combined block may fall below the nominal 6–20 entries —
 * that is acceptable).
 */
export async function buildConversationRecallLists(
  params: ConversationRecallListsParams,
): Promise<string> {
  const { characterId, currentChatId, userId, embeddingProfileId, relevanceQuery, maxContext } = params
  const recentLimit = rampLimit(
    maxContext,
    RECAP_CONVERSATIONS_MIN,
    RECAP_CONVERSATIONS_MAX,
    RECENT_CONVERSATIONS_RAMP_MIN_TOKENS,
    RECENT_CONVERSATIONS_RAMP_MAX_TOKENS,
  )
  const relevantLimit = rampLimit(
    maxContext,
    RECAP_CONVERSATIONS_MIN,
    RECAP_CONVERSATIONS_MAX,
    RECENT_CONVERSATIONS_RAMP_MIN_TOKENS,
    RECENT_CONVERSATIONS_RAMP_MAX_TOKENS,
  )
  if (recentLimit <= 0 && relevantLimit <= 0) return ''

  const repos = getRepositories()

  // Relevant list — semantic retrieval over the embedded vault summaries.
  let relevant: VaultConversationMatch[] = []
  const trimmedQuery = relevanceQuery?.trim()
  if (relevantLimit > 0 && trimmedQuery) {
    try {
      relevant = await searchVaultConversationSummaries({
        characterId,
        query: trimmedQuery,
        userId,
        embeddingProfileId,
        limit: relevantLimit,
        excludeConversationId: currentChatId,
      })
    } catch (error) {
      recapLogger.warn('Failed to build relevant-conversations list', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Recent list — recency-ordered chats that carry a summary.
  let recent: Awaited<ReturnType<typeof repos.chats.findRecentSummarizedByCharacter>> = []
  if (recentLimit > 0) {
    try {
      recent = await repos.chats.findRecentSummarizedByCharacter(characterId, {
        limit: recentLimit,
        excludeChatId: currentChatId,
      })
    } catch (error) {
      recapLogger.warn('Failed to build recent-conversations list', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Dedup: a conversation in both lists stays in relevant, dropped from recent.
  const relevantIds = new Set(relevant.map(r => r.conversationId))
  const recentFiltered = recent.filter(c => !relevantIds.has(c.id))

  if (relevant.length === 0 && recentFiltered.length === 0) return ''

  const sections: string[] = []
  const relevantBlock = renderRelevantConversationsBlock(relevant)
  if (relevantBlock) {
    sections.push(relevantBlock)
  }
  if (recentFiltered.length > 0) {
    const entries = recentFiltered
      .map(c => {
        const gist = (c.contextSummary ?? '').trim()
        return gist.length > 0
          ? `#### ${c.title} (\`${c.id}\`)\n${truncateGist(gist)}`
          : `#### ${c.title} (\`${c.id}\`)`
      })
      .join('\n\n')
    sections.push(`### Recent Conversations\n\n${entries}`)
  }

  return `${sections.join('\n\n')}\n\n${READ_CONVERSATION_CALL_NOTE}`
}

const recapLogger = logger.child({ module: 'MemoryRecap' })

/**
 * Result of generating a memory recap
 */
export interface MemoryRecapResult {
  /** Formatted recap content for prompt injection (empty string if no memories) */
  content: string
  /** Number of memories that were summarized */
  memoriesUsed: number
  /** Token usage from the cheap LLM call */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * Generate a memory recap for a character at the start of a conversation.
 *
 * Fetches recent memories across importance tiers (limits defined in
 * findRecentByImportanceTier), sends them to the cheap LLM for narrative summarization, and returns
 * formatted content ready for injection into the system prompt.
 *
 * For dangerous chats or when the cheap LLM refuses to process the memories,
 * the uncensored fallback provider is used automatically.
 *
 * @param characterId - The character whose memories to recap
 * @param characterName - The character's display name
 * @param selection - Cheap LLM selection for summarization
 * @param userId - User ID for API key access
 * @param chatId - Optional chat ID for logging (also excluded from both conversation lists)
 * @param uncensoredFallback - Optional uncensored provider fallback for dangerous content
 * @param maxContext - Connection profile's maxContext in tokens, used to scale how many
 *   conversation entries each list (recent + relevant) includes (ramp 4K→3, 32K→10)
 * @param relevanceQuery - Free-text describing the current moment; drives the
 *   relevant-conversations semantic search. Empty/omitted skips the relevant list.
 * @param embeddingProfileId - Embedding profile for the relevant-conversations search
 * @returns MemoryRecapResult with the formatted recap content
 */
export async function generateMemoryRecap(
  characterId: string,
  characterName: string,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  maxContext?: number | null,
  relevanceQuery?: string,
  embeddingProfileId?: string | null,
): Promise<MemoryRecapResult> {
  const startTime = Date.now()

  recapLogger.debug('Generating memory recap', {
    characterId,
    characterName,
    chatId,
    hasUncensoredFallback: !!uncensoredFallback,
  })

  try {
    const repos = getRepositories()

    // Fetch memories across all three importance tiers
    const tiered = await repos.memories.findRecentByImportanceTier(characterId)

    const totalCount = tiered.high.length + tiered.medium.length + tiered.low.length

    recapLogger.debug('Fetched tiered memories for recap', {
      characterId,
      high: tiered.high.length,
      medium: tiered.medium.length,
      low: tiered.low.length,
      total: totalCount,
    })

    // Build the two conversation lists (recent + relevant) from vault summaries;
    // independent of the tiered-memory narrative below.
    const conversationsBlock = await buildConversationRecallLists({
      characterId,
      currentChatId: chatId,
      userId,
      embeddingProfileId,
      relevanceQuery: relevanceQuery ?? '',
      maxContext,
    })

    let narrative = ''
    let usage: MemoryRecapResult['usage'] | undefined

    if (totalCount > 0) {
      // Format memories with relative age labels for the summarization prompt
      const now = new Date()
      const formatTier = (memories: Memory[]) =>
        memories.map(m => ({
          summary: m.summary,
          age: formatRelativeAge(m, now),
        }))

      const tieredWithAge = {
        high: formatTier(tiered.high),
        medium: formatTier(tiered.medium),
        low: formatTier(tiered.low),
      }

      // Send to cheap LLM for summarization (with uncensored fallback for dangerous content)
      const result = await summarizeMemoryRecap(
        characterName,
        tieredWithAge,
        selection,
        userId,
        chatId,
        uncensoredFallback,
        characterId
      )

      if (!result.success || !result.result) {
        recapLogger.warn('Memory recap summarization failed', {
          characterId,
          error: result.error,
        })
      } else if (result.result.length > 0) {
        narrative = result.result
        usage = result.usage
      } else {
        recapLogger.debug('Memory recap returned empty (no meaningful memories)', { characterId })
      }
    }

    if (!narrative && !conversationsBlock) {
      recapLogger.debug('No memories or conversation lists found for recap, skipping', { characterId })
      return { content: '', memoriesUsed: 0 }
    }

    const intro = `## What You Remember\nAs ${characterName}, here is what you recall from your experiences and past conversations:`
    const sections = [intro]
    if (narrative) sections.push(narrative)
    if (conversationsBlock) sections.push(conversationsBlock)
    const formattedContent = sections.join('\n\n')

    const elapsed = Date.now() - startTime

    recapLogger.info('Memory recap generated', {
      characterId,
      characterName,
      memoriesUsed: totalCount,
      narrativeLength: narrative.length,
      hasConversationLists: !!conversationsBlock,
      elapsed,
      usage,
    })

    return {
      content: formattedContent,
      memoriesUsed: totalCount,
      usage,
    }
  } catch (error) {
    const elapsed = Date.now() - startTime
    recapLogger.error('Failed to generate memory recap', {
      characterId,
      characterName,
      elapsed,
    }, error instanceof Error ? error : undefined)

    return { content: '', memoriesUsed: 0 }
  }
}
