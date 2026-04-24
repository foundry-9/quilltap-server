/**
 * Memory Injector
 *
 * Formats memories for injection into LLM context.
 * Handles both character memories and inter-character memories.
 */

import type { Provider, Memory } from '@/lib/schemas/types'
import { estimateTokens, truncateToTokenLimit } from '@/lib/tokens/token-counter'
import { calculateEffectiveWeight, formatRelativeAge } from '@/lib/memory/memory-weighting'
import type { SemanticSearchResult } from '@/lib/memory/memory-service'

/**
 * Debug info for included memories
 */
export interface DebugMemoryInfo {
  summary: string
  importance: number
  score: number
  effectiveWeight: number
}

/**
 * Debug info for inter-character memories
 */
export interface DebugInterCharacterMemoryInfo {
  aboutCharacterName: string
  summary: string
  importance: number
}

/**
 * Result of formatting memories for context
 */
export interface FormattedMemoriesResult {
  content: string
  tokenCount: number
  memoriesUsed: number
  debugMemories: DebugMemoryInfo[]
}

/**
 * Result of formatting inter-character memories for context
 */
export interface FormattedInterCharacterMemoriesResult {
  content: string
  tokenCount: number
  memoriesUsed: number
  debugMemories: DebugInterCharacterMemoryInfo[]
}

/**
 * Format memories for injection into context
 */
export function formatMemoriesForContext(
  memories: SemanticSearchResult[],
  maxTokens: number,
  provider: Provider
): FormattedMemoriesResult {
  if (memories.length === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  const memoryParts: string[] = ['## Relevant Memories']
  let currentTokens = estimateTokens('## Relevant Memories\n', provider)
  let memoriesUsed = 0
  const debugMemories: DebugMemoryInfo[] = []

  // Calculate effective weights and sort by weight (primary), score (tiebreaker)
  const memoriesWithWeight = memories.map(r => ({
    ...r,
    weight: r.effectiveWeight ?? calculateEffectiveWeight(r.memory).effectiveWeight,
  }))

  const sortedMemories = memoriesWithWeight.sort((a, b) => {
    const weightDiff = b.weight - a.weight
    if (Math.abs(weightDiff) > 0.05) return weightDiff
    return b.score - a.score
  })

  const now = new Date()

  for (const { memory, score, weight } of sortedMemories) {
    // Use summary with relative age label for temporal context
    const age = formatRelativeAge(memory, now)
    const memoryLine = `- [${age}] ${memory.summary}`
    const lineTokens = estimateTokens(memoryLine + '\n', provider)

    if (currentTokens + lineTokens > maxTokens) {
      break
    }

    memoryParts.push(memoryLine)
    currentTokens += lineTokens
    memoriesUsed++
    debugMemories.push({
      summary: memory.summary,
      importance: memory.importance,
      score,
      effectiveWeight: weight,
    })
  }

  if (memoriesUsed === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  return {
    content: memoryParts.join('\n'),
    tokenCount: currentTokens,
    memoriesUsed,
    debugMemories,
  }
}

/**
 * Format inter-character memories for injection into context
 * These are memories that the responding character has about other characters in the chat
 */
export function formatInterCharacterMemoriesForContext(
  memories: Memory[],
  characterNames: Map<string, string>, // aboutCharacterId -> character name
  maxTokens: number,
  provider: Provider
): FormattedInterCharacterMemoriesResult {
  if (memories.length === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  const memoryParts: string[] = ['## Memories About Other Characters']
  let currentTokens = estimateTokens('## Memories About Other Characters\n', provider)
  let memoriesUsed = 0
  const debugMemories: DebugInterCharacterMemoryInfo[] = []

  // Group memories by character
  const memoriesByCharacter = new Map<string, Memory[]>()
  for (const memory of memories) {
    if (memory.aboutCharacterId) {
      const existing = memoriesByCharacter.get(memory.aboutCharacterId) || []
      existing.push(memory)
      memoriesByCharacter.set(memory.aboutCharacterId, existing)
    }
  }

  // Sort memories within each character by effective weight
  for (const [characterId, charMemories] of memoriesByCharacter) {
    const characterName = characterNames.get(characterId) || 'Unknown'
    const sortedMemories = [...charMemories]
      .map(m => ({ memory: m, weight: calculateEffectiveWeight(m).effectiveWeight }))
      .sort((a, b) => b.weight - a.weight)

    const now = new Date()
    for (const { memory } of sortedMemories) {
      const age = formatRelativeAge(memory, now)
      const memoryLine = `- About ${characterName}: [${age}] ${memory.summary}`
      const lineTokens = estimateTokens(memoryLine + '\n', provider)

      if (currentTokens + lineTokens > maxTokens) {
        break
      }

      memoryParts.push(memoryLine)
      currentTokens += lineTokens
      memoriesUsed++
      debugMemories.push({
        aboutCharacterName: characterName,
        summary: memory.summary,
        importance: memory.importance,
      })
    }
  }

  if (memoriesUsed === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  return {
    content: memoryParts.join('\n'),
    tokenCount: currentTokens,
    memoriesUsed,
    debugMemories,
  }
}

/**
 * Format conversation summary for context
 */
export function formatSummaryForContext(
  summary: string,
  maxTokens: number,
  provider: Provider
): { content: string; tokenCount: number } {
  if (!summary || summary.trim().length === 0) {
    return { content: '', tokenCount: 0 }
  }

  const header = '## Previous Conversation Summary'
  const fullContent = `${header}\n${summary}`
  const fullTokens = estimateTokens(fullContent, provider)

  if (fullTokens <= maxTokens) {
    return { content: fullContent, tokenCount: fullTokens }
  }

  // Truncate summary to fit
  const headerTokens = estimateTokens(header + '\n', provider)
  const availableForSummary = maxTokens - headerTokens
  const truncatedSummary = truncateToTokenLimit(summary, availableForSummary, provider)

  return {
    content: `${header}\n${truncatedSummary}`,
    tokenCount: estimateTokens(`${header}\n${truncatedSummary}`, provider),
  }
}
