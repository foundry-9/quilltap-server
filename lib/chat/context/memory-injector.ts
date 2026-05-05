/**
 * Memory Injector
 *
 * Formats memories for injection into LLM context.
 * Handles both character memories and inter-character memories.
 */

import type { Provider, Memory } from '@/lib/schemas/types'
import type { SceneState } from '@/lib/schemas/chat.types'
import { estimateTokens, truncateToTokenLimit } from '@/lib/tokens/token-counter'
import { calculateEffectiveWeight, formatRelativeAge } from '@/lib/memory/memory-weighting'
import type { SemanticSearchResult } from '@/lib/memory/memory-service'

/** Phase 3b: hard cap on the dynamic-head rank instruction. */
export const DYNAMIC_HEAD_TOKEN_BUDGET = 200
/** Phase 3b: how many rank-instruction entries to attempt. */
export const DYNAMIC_HEAD_DEFAULT_SIZE = 5

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
 * Render the latest scene-state snapshot as the `## Current State` section
 * for the Commonplace Book whisper. Returns `''` when no scene state is
 * available so callers can treat the section as absent.
 *
 * `time` is the chat's announced timestamp (the same string the Host
 * announces); pass `null`/`undefined` when the chat is not announcing time
 * and the Time line is dropped entirely.
 */
export function formatCurrentSceneState(
  sceneState: SceneState | null | undefined,
  time: string | null | undefined,
  provider?: Provider,
): { content: string; tokenCount: number } {
  if (!sceneState) return { content: '', tokenCount: 0 }

  const characters = Array.isArray(sceneState.characters) ? sceneState.characters : []
  const names = characters.map(c => c.characterName).filter(n => typeof n === 'string' && n.length > 0)

  const lines: string[] = ['## Current State', '']
  lines.push(`- **Location**: ${sceneState.location || 'Unknown'}`)
  lines.push(`- **Characters Present**: ${names.join(', ')}`)
  if (time && time.trim().length > 0) {
    lines.push(`- **Time**: ${time.trim()}`)
  }
  lines.push('- **Active Now**: true')

  for (const c of characters) {
    if (!c.characterName) continue
    lines.push('')
    lines.push(`### ${c.characterName}`)
    lines.push('')
    lines.push('#### Action')
    lines.push('')
    lines.push((c.action ?? '').trim() || '_unspecified_')
    lines.push('')
    lines.push('#### Clothing')
    lines.push('')
    lines.push((c.clothing ?? '').trim() || '_unspecified_')
  }

  const content = lines.join('\n')
  const tokenCount = estimateTokens(content + '\n', provider)
  return { content, tokenCount }
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
    // Use full content (not summary) so the whisper carries the same nuance the
    // model formed at extraction time. Summary is the cache-friendly form for
    // recap LLM inputs, but the per-line whisper has the budget for the body.
    const age = formatRelativeAge(memory, now)
    const body = memory.content?.trim() || memory.summary
    const memoryLine = `- [${age}] ${body}`
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
      const body = memory.content?.trim() || memory.summary
      const memoryLine = `- About ${characterName}: [${age}] ${body}`
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
 * Phase 3a: Format the frozen-archive memory pool for context.
 *
 * The archive is a stable per-generation slice (already sorted by `memory.id`
 * by the caller — see `frozen-archive-cache.ts`). The output uses
 * `memory.summary` rather than `memory.content` so the bytes stay compact and
 * the cache prefix doesn't bloat. No per-turn re-ranking is performed: order
 * follows the input array verbatim so prefix-cache bytes are byte-stable
 * across turns within a generation.
 */
export function formatFrozenMemoryArchive(
  memories: Memory[],
  maxTokens: number,
  provider: Provider,
): FormattedMemoriesResult {
  if (memories.length === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  const header = '## Memory Anchors'
  const memoryParts: string[] = [header]
  let currentTokens = estimateTokens(`${header}\n`, provider)
  let memoriesUsed = 0
  const debugMemories: DebugMemoryInfo[] = []

  for (const memory of memories) {
    const summary = memory.summary?.trim() || memory.content?.trim() || ''
    if (!summary) continue

    const memoryLine = `- ${summary}`
    const lineTokens = estimateTokens(`${memoryLine}\n`, provider)
    if (currentTokens + lineTokens > maxTokens) {
      break
    }

    memoryParts.push(memoryLine)
    currentTokens += lineTokens
    memoriesUsed++
    debugMemories.push({
      summary: memory.summary,
      importance: memory.importance,
      score: 0,
      effectiveWeight: 0,
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
 * Phase 3b: Format a compact "dynamic head" rank instruction for the user-
 * message tail. Hard-capped at `DYNAMIC_HEAD_TOKEN_BUDGET` tokens. Uses
 * `memory.summary` (not full content) and a short id prefix so the LLM can
 * cite the relevant entry without the prompt bloating per turn. Caller is
 * expected to pre-filter out memories already present in the frozen archive.
 */
export function formatDynamicMemoryHead(
  memories: SemanticSearchResult[],
  provider: Provider,
  options: { maxTokens?: number; maxEntries?: number } = {},
): FormattedMemoriesResult {
  const maxTokens = options.maxTokens ?? DYNAMIC_HEAD_TOKEN_BUDGET
  const maxEntries = options.maxEntries ?? DYNAMIC_HEAD_DEFAULT_SIZE

  if (memories.length === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  const ranked = memories
    .map(r => ({
      ...r,
      weight: r.effectiveWeight ?? calculateEffectiveWeight(r.memory).effectiveWeight,
    }))
    .sort((a, b) => {
      const weightDiff = b.weight - a.weight
      if (Math.abs(weightDiff) > 0.05) return weightDiff
      return b.score - a.score
    })
    .slice(0, maxEntries)

  const header = 'Most relevant memories for this turn:'
  const entries: string[] = []
  const debugMemories: DebugMemoryInfo[] = []
  // Reserve token budget for the header + final newline.
  let currentTokens = estimateTokens(`${header}\n`, provider)
  let memoriesUsed = 0

  for (const { memory, score, weight } of ranked) {
    const summary = memory.summary?.trim() || memory.content?.trim() || ''
    if (!summary) continue
    const idTag = `[m_${memory.id.slice(0, 4)}]`
    const entry = `${idTag} ${summary}`
    const candidateTokens = estimateTokens(`${entry}\n`, provider)
    if (currentTokens + candidateTokens > maxTokens) {
      break
    }
    entries.push(entry)
    currentTokens += candidateTokens
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
    content: `${header}\n${entries.join('\n')}`,
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
