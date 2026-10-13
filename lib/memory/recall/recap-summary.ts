/**
 * The memory recap summariser: a character's tiered memories as a short
 * first-person recollection at the start of a conversation. Moved unchanged
 * from the retired `cheap-llm-tasks/memory-tasks.ts` (memory refactor Phase D).
 *
 * @module memory/recall/recap-summary
 */

import type { LLMMessage } from '@/lib/llm/base'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { executeCheapLLMTask } from '../cheap-llm-tasks/core-execution'
import type { CheapLLMTaskResult, UncensoredFallbackOptions } from '../cheap-llm-tasks/types'

const MEMORY_RECAP_PROMPT = `You are summarizing a character's memories to help them recall what they know at the start of a conversation.

You will receive memories organized by importance (high, medium, low), each with a relative age label.

Write a concise first-person narrative summary (from the character's perspective, using "I") of what the character remembers. Focus on:
- Key relationships and what the character knows about other people
- Important events and emotional moments
- Ongoing situations or unresolved threads
- Recent interactions and their significance

Keep the summary under 500 words. Use natural language, not bullet points. Write as a stream of consciousness — what's top of mind, what lingers, what matters. More recent and higher-importance memories should be given more weight.

If there are no memories, respond with exactly: NO_MEMORIES`

/**
 * Summarizes a character's tiered memories into a narrative recap.
 * Sent to the cheap LLM so the character has a sense of "what I remember"
 * at the start of a conversation.
 *
 * @param characterName - The character's name (for prompt context)
 * @param tieredMemories - Memories grouped by importance tier with age labels
 * @param selection - Cheap LLM selection to use
 * @param userId - User ID for API key access
 * @param chatId - Optional chat ID for logging
 * @returns Summarized memory recap text
 */
export async function summarizeMemoryRecap(
  characterName: string,
  tieredMemories: {
    high: Array<{ summary: string; age: string }>
    medium: Array<{ summary: string; age: string }>
    low: Array<{ summary: string; age: string }>
  },
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  characterId?: string
): Promise<CheapLLMTaskResult<string>> {
  const totalCount = tieredMemories.high.length + tieredMemories.medium.length + tieredMemories.low.length
  if (totalCount === 0) {
    return { success: true, result: '' }
  }

  const formatTier = (label: string, memories: Array<{ summary: string; age: string }>) => {
    if (memories.length === 0) return ''
    const lines = memories.map(m => `- [${m.age}] ${m.summary}`).join('\n')
    return `### ${label} Importance\n${lines}`
  }

  const memoriesText = [
    formatTier('High', tieredMemories.high),
    formatTier('Medium', tieredMemories.medium),
    formatTier('Low', tieredMemories.low),
  ].filter(Boolean).join('\n\n')

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: MEMORY_RECAP_PROMPT,
    },
    {
      role: 'user',
      content: `Character: ${characterName}\n\n## Memories\n${memoriesText}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): string => {
      const trimmed = content.trim()
      if (trimmed === 'NO_MEMORIES') return ''
      return trimmed
    },
    'memory-recap-summarization',
    chatId,
    undefined,
    uncensoredFallback,
    undefined,
    characterId,
    // The recap is assembled inline while a visible turn waits on
    // "Recalling…", and it is optional context — losing it costs the character
    // some remembered flavour, not the turn. So it takes the tighter of the
    // two budgets and forgoes the retry a background pass would get (bug 107).
    { latency: 'interactive' },
  )
}
