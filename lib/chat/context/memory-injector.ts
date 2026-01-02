/**
 * Memory Injector
 *
 * Formats memories for injection into LLM context.
 * Handles both character memories and inter-character memories.
 */

import type { Provider, Memory } from '@/lib/schemas/types'
import { estimateTokens } from '@/lib/tokens/token-counter'
import type { SemanticSearchResult } from '@/lib/memory/memory-service'

/**
 * Debug info for included memories
 */
export interface DebugMemoryInfo {
  summary: string
  importance: number
  score: number
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

  // Sort by relevance score (highest first)
  const sortedMemories = [...memories].sort((a, b) => {
    // First by score, then by importance
    const scoreDiff = b.score - a.score
    if (Math.abs(scoreDiff) > 0.1) return scoreDiff
    return b.memory.importance - a.memory.importance
  })

  for (const { memory, score } of sortedMemories) {
    // Use summary for context (more concise)
    const memoryLine = `- ${memory.summary}`
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

  // Sort memories within each character by importance
  for (const [characterId, charMemories] of memoriesByCharacter) {
    const characterName = characterNames.get(characterId) || 'Unknown'
    const sortedMemories = [...charMemories].sort((a, b) => b.importance - a.importance)

    for (const memory of sortedMemories) {
      const memoryLine = `- About ${characterName}: ${memory.summary}`
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
  const { truncateToTokenLimit } = require('@/lib/tokens/token-counter')
  const headerTokens = estimateTokens(header + '\n', provider)
  const availableForSummary = maxTokens - headerTokens
  const truncatedSummary = truncateToTokenLimit(summary, availableForSummary, provider)

  return {
    content: `${header}\n${truncatedSummary}`,
    tokenCount: estimateTokens(`${header}\n${truncatedSummary}`, provider),
  }
}
