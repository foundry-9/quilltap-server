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
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { Memory } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'

// Linear ramp: at maxContext ≤ 4K, show MIN entries (~half the budget). At ≥ 32K, show MAX.
const RECENT_CONVERSATIONS_MIN = 5
const RECENT_CONVERSATIONS_MAX = 20
const RECENT_CONVERSATIONS_RAMP_MIN_TOKENS = 4000
const RECENT_CONVERSATIONS_RAMP_MAX_TOKENS = 32000

export function calculateRecentConversationsLimit(maxContext?: number | null): number {
  if (maxContext == null) return RECENT_CONVERSATIONS_MAX
  if (maxContext <= RECENT_CONVERSATIONS_RAMP_MIN_TOKENS) return RECENT_CONVERSATIONS_MIN
  if (maxContext >= RECENT_CONVERSATIONS_RAMP_MAX_TOKENS) return RECENT_CONVERSATIONS_MAX
  const ratio =
    (maxContext - RECENT_CONVERSATIONS_RAMP_MIN_TOKENS) /
    (RECENT_CONVERSATIONS_RAMP_MAX_TOKENS - RECENT_CONVERSATIONS_RAMP_MIN_TOKENS)
  return Math.round(
    RECENT_CONVERSATIONS_MIN + ratio * (RECENT_CONVERSATIONS_MAX - RECENT_CONVERSATIONS_MIN)
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
 * @param chatId - Optional chat ID for logging (also excluded from the Recent Conversations block)
 * @param uncensoredFallback - Optional uncensored provider fallback for dangerous content
 * @param maxContext - Connection profile's maxContext in tokens, used to scale how many
 *   recent-conversation summaries to include (linear ramp 4K→5, 32K→20)
 * @returns MemoryRecapResult with the formatted recap content
 */
export async function generateMemoryRecap(
  characterId: string,
  characterName: string,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  maxContext?: number | null
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

    // Always try to fetch the recent-conversations block; it's independent of memories
    const recentConversationsLimit = calculateRecentConversationsLimit(maxContext)
    const recentConversationsBlock = await buildRecentConversationsBlock(
      characterId,
      chatId,
      recentConversationsLimit
    )

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

    if (!narrative && !recentConversationsBlock) {
      recapLogger.debug('No memories or recent conversations found for recap, skipping', { characterId })
      return { content: '', memoriesUsed: 0 }
    }

    const intro = `## What You Remember\nAs ${characterName}, here is what you recall from your experiences and past conversations:`
    const sections = [intro]
    if (narrative) sections.push(narrative)
    if (recentConversationsBlock) sections.push(recentConversationsBlock)
    const formattedContent = sections.join('\n\n')

    const elapsed = Date.now() - startTime

    recapLogger.info('Memory recap generated', {
      characterId,
      characterName,
      memoriesUsed: totalCount,
      narrativeLength: narrative.length,
      hasRecentConversations: !!recentConversationsBlock,
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
