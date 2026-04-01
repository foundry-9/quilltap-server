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
 * Fetches the last 50 high-importance, 20 medium-importance, and 10 low-importance
 * memories, sends them to the cheap LLM for narrative summarization, and returns
 * formatted content ready for injection into the system prompt.
 *
 * For dangerous chats or when the cheap LLM refuses to process the memories,
 * the uncensored fallback provider is used automatically.
 *
 * @param characterId - The character whose memories to recap
 * @param characterName - The character's display name
 * @param selection - Cheap LLM selection for summarization
 * @param userId - User ID for API key access
 * @param chatId - Optional chat ID for logging
 * @param uncensoredFallback - Optional uncensored provider fallback for dangerous content
 * @returns MemoryRecapResult with the formatted recap content
 */
export async function generateMemoryRecap(
  characterId: string,
  characterName: string,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string,
  uncensoredFallback?: UncensoredFallbackOptions
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

    if (totalCount === 0) {
      recapLogger.debug('No memories found for recap, skipping', { characterId })
      return { content: '', memoriesUsed: 0 }
    }

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
      uncensoredFallback
    )

    const elapsed = Date.now() - startTime

    if (!result.success || !result.result) {
      recapLogger.warn('Memory recap summarization failed', {
        characterId,
        error: result.error,
        elapsed,
      })
      return { content: '', memoriesUsed: 0 }
    }

    if (result.result.length === 0) {
      recapLogger.debug('Memory recap returned empty (no meaningful memories)', {
        characterId,
        elapsed,
      })
      return { content: '', memoriesUsed: 0 }
    }

    // Format the recap for injection into the system prompt
    const formattedContent = `## What You Remember\nAs ${characterName}, here is what you recall from your experiences and past conversations:\n\n${result.result}`

    recapLogger.info('Memory recap generated', {
      characterId,
      characterName,
      memoriesUsed: totalCount,
      recapLength: result.result.length,
      elapsed,
      usage: result.usage,
    })

    return {
      content: formattedContent,
      memoriesUsed: totalCount,
      usage: result.usage,
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
