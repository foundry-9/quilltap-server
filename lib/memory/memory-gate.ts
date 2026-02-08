/**
 * Memory Gate — Pre-Write Similarity Check
 *
 * Replaces the binary duplicate check with a three-tier decision at write time:
 * - REINFORCE: near-duplicate (>= 0.80 similarity) — boost existing memory
 * - INSERT_RELATED: related but distinct (0.70–0.80) — link memories together
 * - INSERT: genuinely new (< 0.70) — create fresh memory
 *
 * This changes the memory system from append-only to append-or-reinforce,
 * preserving signal about repeatedly observed facts.
 */

import { Memory } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { getCharacterVectorStore } from '@/lib/embedding/vector-store'
import { generateEmbeddingForUser, EmbeddingError } from '@/lib/embedding/embedding-service'
import { logger } from '@/lib/logger'

// =============================================================================
// Constants
// =============================================================================

/** Near-duplicate threshold — memories above this are reinforced, not duplicated */
export const MERGE_THRESHOLD = 0.80

/** Related-but-distinct threshold — memories in this band get linked */
export const RELATED_THRESHOLD = 0.70

/** Top-K results to fetch from vector store during gate check */
const GATE_TOP_K = 5

// =============================================================================
// Types
// =============================================================================

export type GateDecision =
  | { action: 'INSERT' }
  | { action: 'REINFORCE'; existingMemory: Memory; similarity: number }
  | { action: 'INSERT_RELATED'; relatedMemories: { memory: Memory; similarity: number }[] }

export interface GateResult {
  decision: GateDecision
  embedding: number[] | null
  debugInfo: string[]
}

export interface MemoryGateOutcome {
  memory: Memory
  action: 'INSERT' | 'REINFORCE' | 'INSERT_RELATED' | 'SKIP_GATE'
  novelDetails?: string[]
  relatedMemoryIds?: string[]
}

// =============================================================================
// Reinforced Importance Formula
// =============================================================================

/**
 * Calculate reinforced importance: importance + log2(count + 1) * 0.05, capped at 1.0
 */
export function calculateReinforcedImportance(baseImportance: number, reinforcementCount: number): number {
  return Math.min(1.0, baseImportance + Math.log2(reinforcementCount + 1) * 0.05)
}

// =============================================================================
// Gate Core
// =============================================================================

/**
 * Run the Memory Gate — decide whether to INSERT, REINFORCE, or INSERT_RELATED.
 *
 * 1. Generate embedding for candidate content.
 * 2. Search character's vector store for similar memories (top-K).
 * 3. Best match >= MERGE_THRESHOLD → REINFORCE.
 * 4. Any match in RELATED_THRESHOLD–MERGE_THRESHOLD → INSERT_RELATED.
 * 5. All below RELATED_THRESHOLD → INSERT.
 * 6. If embedding fails, fall back to keyword-based overlap.
 */
export async function runMemoryGate(
  characterId: string,
  candidateContent: string,
  candidateSummary: string,
  candidateKeywords: string[],
  userId: string,
  embeddingProfileId?: string
): Promise<GateResult> {
  const debugInfo: string[] = []

  // Try semantic gate first
  try {
    const embeddingText = `${candidateSummary}\n\n${candidateContent}`
    const embeddingResult = await generateEmbeddingForUser(
      embeddingText,
      userId,
      embeddingProfileId
    )

    const embedding = embeddingResult.embedding
    debugInfo.push(`[Gate] Generated embedding (${embedding.length} dimensions)`)

    const vectorStore = await getCharacterVectorStore(characterId)
    const results = vectorStore.search(embedding, GATE_TOP_K)

    if (results.length === 0) {
      debugInfo.push('[Gate] No existing memories in vector store → INSERT')
      return { decision: { action: 'INSERT' }, embedding, debugInfo }
    }

    // Get full memory data for matched IDs
    const repos = getRepositories()
    const allMemories = await repos.memories.findByCharacterId(characterId)
    const memoryMap = new Map(allMemories.map(m => [m.id, m]))

    // Find best match
    const bestResult = results[0]
    const bestMemory = memoryMap.get(bestResult.id)

    debugInfo.push(`[Gate] Best match: score=${bestResult.score.toFixed(3)}, id=${bestResult.id}`)

    if (bestResult.score >= MERGE_THRESHOLD && bestMemory) {
      debugInfo.push(`[Gate] Score >= ${MERGE_THRESHOLD} → REINFORCE`)
      return {
        decision: {
          action: 'REINFORCE',
          existingMemory: bestMemory,
          similarity: bestResult.score,
        },
        embedding,
        debugInfo,
      }
    }

    // Check for related memories in the band
    const relatedMatches = results
      .filter(r => r.score >= RELATED_THRESHOLD && r.score < MERGE_THRESHOLD)
      .map(r => ({ memory: memoryMap.get(r.id)!, similarity: r.score }))
      .filter(r => r.memory)

    if (relatedMatches.length > 0) {
      debugInfo.push(`[Gate] ${relatedMatches.length} match(es) in ${RELATED_THRESHOLD}–${MERGE_THRESHOLD} band → INSERT_RELATED`)
      return {
        decision: { action: 'INSERT_RELATED', relatedMemories: relatedMatches },
        embedding,
        debugInfo,
      }
    }

    debugInfo.push(`[Gate] All matches below ${RELATED_THRESHOLD} → INSERT`)
    return { decision: { action: 'INSERT' }, embedding, debugInfo }
  } catch (error) {
    // Embedding generation failed — fall back to keyword-based gate
    if (error instanceof EmbeddingError) {
      debugInfo.push(`[Gate] Embedding failed (${error.message}), falling back to keyword gate`)
    } else {
      debugInfo.push(`[Gate] Unexpected error, falling back to keyword gate: ${String(error)}`)
    }

    return keywordBasedGate(characterId, candidateContent, candidateKeywords, debugInfo)
  }
}

// =============================================================================
// Keyword Fallback Gate
// =============================================================================

/**
 * Keyword-based gate fallback when embeddings are unavailable.
 * - 70%+ keyword overlap → REINFORCE
 * - 50–70% overlap → INSERT_RELATED
 * - <50% → INSERT
 */
async function keywordBasedGate(
  characterId: string,
  candidateContent: string,
  candidateKeywords: string[],
  debugInfo: string[]
): Promise<GateResult> {
  if (!candidateKeywords || candidateKeywords.length === 0) {
    debugInfo.push('[Gate/keyword] No candidate keywords → INSERT')
    return { decision: { action: 'INSERT' }, embedding: null, debugInfo }
  }

  const repos = getRepositories()
  const existingMemories = await repos.memories.findByKeywords(characterId, candidateKeywords)

  if (existingMemories.length === 0) {
    debugInfo.push('[Gate/keyword] No keyword matches → INSERT')
    return { decision: { action: 'INSERT' }, embedding: null, debugInfo }
  }

  let bestOverlap = 0
  let bestMemory: Memory | null = null
  const relatedMemories: { memory: Memory; similarity: number }[] = []

  for (const memory of existingMemories) {
    const memoryContent = memory.content.toLowerCase()
    const matchingKeywords = candidateKeywords.filter(
      kw => memoryContent.includes(kw.toLowerCase())
    )
    const overlap = matchingKeywords.length / candidateKeywords.length

    if (overlap > bestOverlap) {
      bestOverlap = overlap
      bestMemory = memory
    }

    if (overlap >= 0.5 && overlap < 0.7) {
      relatedMemories.push({ memory, similarity: overlap })
    }
  }

  if (bestOverlap >= 0.7 && bestMemory) {
    debugInfo.push(`[Gate/keyword] ${(bestOverlap * 100).toFixed(0)}% keyword overlap → REINFORCE`)
    return {
      decision: { action: 'REINFORCE', existingMemory: bestMemory, similarity: bestOverlap },
      embedding: null,
      debugInfo,
    }
  }

  if (relatedMemories.length > 0) {
    debugInfo.push(`[Gate/keyword] ${relatedMemories.length} match(es) in 50–70% band → INSERT_RELATED`)
    return {
      decision: { action: 'INSERT_RELATED', relatedMemories },
      embedding: null,
      debugInfo,
    }
  }

  debugInfo.push(`[Gate/keyword] Best overlap ${(bestOverlap * 100).toFixed(0)}% < 50% → INSERT`)
  return { decision: { action: 'INSERT' }, embedding: null, debugInfo }
}

// =============================================================================
// Reinforcement
// =============================================================================

/**
 * Reinforce an existing memory with new observations.
 *
 * 1. Extract novel details from candidate not present in existing memory.
 * 2. Append novel details as footnotes.
 * 3. Increment reinforcementCount, update lastReinforcedAt.
 * 4. Recalculate reinforcedImportance.
 * 5. Re-embed if content changed.
 * 6. Return updated memory.
 */
export async function reinforceMemory(
  existingMemory: Memory,
  candidateContent: string,
  candidateSummary: string,
  userId: string,
  embeddingProfileId?: string
): Promise<{ memory: Memory; novelDetails: string[] }> {
  const repos = getRepositories()
  const novelDetails = extractNovelDetails(candidateContent, existingMemory.content)

  const newCount = (existingMemory.reinforcementCount ?? 1) + 1
  const now = new Date().toISOString()
  const newReinforcedImportance = calculateReinforcedImportance(existingMemory.importance, newCount)

  let newContent = existingMemory.content
  if (novelDetails.length > 0) {
    const footnotes = novelDetails.map(d => `[+] ${d}`).join('\n')
    newContent = `${existingMemory.content}\n${footnotes}`
  }

  const contentChanged = newContent !== existingMemory.content

  const updateData: Partial<Memory> = {
    reinforcementCount: newCount,
    lastReinforcedAt: now,
    reinforcedImportance: newReinforcedImportance,
  }

  if (contentChanged) {
    updateData.content = newContent
  }

  const updatedMemory = await repos.memories.updateForCharacter(
    existingMemory.characterId,
    existingMemory.id,
    updateData
  )

  if (!updatedMemory) {
    logger.warn('[MemoryGate] Failed to update memory during reinforcement', {
      memoryId: existingMemory.id,
      characterId: existingMemory.characterId,
    })
    return { memory: existingMemory, novelDetails }
  }

  // Re-embed if content changed
  if (contentChanged) {
    try {
      const embeddingResult = await generateEmbeddingForUser(
        `${updatedMemory.summary}\n\n${updatedMemory.content}`,
        userId,
        embeddingProfileId
      )

      await repos.memories.updateForCharacter(
        existingMemory.characterId,
        existingMemory.id,
        { embedding: embeddingResult.embedding }
      )

      const vectorStore = await getCharacterVectorStore(existingMemory.characterId)
      if (vectorStore.hasVector(existingMemory.id)) {
        await vectorStore.updateVector(existingMemory.id, embeddingResult.embedding)
      } else {
        await vectorStore.addVector(existingMemory.id, embeddingResult.embedding, {
          memoryId: existingMemory.id,
          characterId: existingMemory.characterId,
          content: updatedMemory.summary,
        })
      }
      await vectorStore.save()
    } catch (error) {
      logger.warn('[MemoryGate] Failed to re-embed reinforced memory', {
        memoryId: existingMemory.id,
        error: String(error),
      })
    }
  }

  logger.debug('[MemoryGate] Memory reinforced', {
    memoryId: existingMemory.id,
    characterId: existingMemory.characterId,
    reinforcementCount: newCount,
    reinforcedImportance: newReinforcedImportance,
    novelDetailsCount: novelDetails.length,
    contentChanged,
  })

  return { memory: updatedMemory, novelDetails }
}

// =============================================================================
// Related Memory Linking
// =============================================================================

/**
 * Bidirectionally link a new memory with related existing memories.
 */
export async function linkRelatedMemories(
  newMemoryId: string,
  newMemoryCharacterId: string,
  relatedMemories: { memory: Memory; similarity: number }[]
): Promise<string[]> {
  const repos = getRepositories()
  const linkedIds: string[] = []

  for (const { memory: related } of relatedMemories) {
    // Add new memory's ID to related memory's relatedMemoryIds
    const existingRelated = related.relatedMemoryIds ?? []
    if (!existingRelated.includes(newMemoryId)) {
      await repos.memories.updateForCharacter(
        related.characterId,
        related.id,
        { relatedMemoryIds: [...existingRelated, newMemoryId] }
      )
    }
    linkedIds.push(related.id)
  }

  // Set relatedMemoryIds on the new memory
  if (linkedIds.length > 0) {
    await repos.memories.updateForCharacter(
      newMemoryCharacterId,
      newMemoryId,
      { relatedMemoryIds: linkedIds }
    )
  }

  logger.debug('[MemoryGate] Linked related memories', {
    newMemoryId,
    linkedCount: linkedIds.length,
    linkedIds,
  })

  return linkedIds
}

// =============================================================================
// Novel Detail Extraction
// =============================================================================

/** Common stop words to filter out of proper noun detection */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'this',
  'that', 'these', 'those', 'it', 'its', 'i', 'he', 'she', 'we', 'they',
  'me', 'him', 'her', 'us', 'them', 'my', 'his', 'our', 'their', 'your',
  'not', 'no', 'if', 'then', 'so', 'up', 'out', 'just', 'also', 'very',
  'about', 'into', 'over', 'after', 'before', 'between', 'through',
  'during', 'without', 'again', 'further', 'once', 'here', 'there',
  'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'than',
  'too', 'now', 'new', 'old', 'first', 'last', 'long', 'great', 'little',
  'right', 'big', 'high', 'small', 'large', 'next', 'early', 'young',
  'important', 'public', 'bad', 'good', 'said', 'told', 'asked', 'went',
  'came', 'made', 'got', 'see', 'know', 'think', 'want', 'say', 'tell',
])

/**
 * Extract novel details from candidate content that are not in existing content.
 *
 * Deterministic, regex-based (no LLM call):
 * 1. Proper nouns (uppercase words not sentence-initial, not stop words)
 * 2. Numbers, dates (various patterns), currency amounts
 * 3. Technical terms (CamelCase, acronyms)
 * 4. Filter out anything already in existing content
 */
export function extractNovelDetails(candidateContent: string, existingContent: string): string[] {
  const existingLower = existingContent.toLowerCase()
  const novelDetails: string[] = []
  const seen = new Set<string>()

  const addIfNovel = (detail: string) => {
    const normalized = detail.trim()
    if (
      normalized.length > 1 &&
      !seen.has(normalized.toLowerCase()) &&
      !existingLower.includes(normalized.toLowerCase())
    ) {
      seen.add(normalized.toLowerCase())
      novelDetails.push(normalized)
    }
  }

  // 1. Proper nouns: uppercase words not at sentence start, not stop words
  // Split into sentences, then check words
  const sentences = candidateContent.split(/[.!?]+/)
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/)
    for (let i = 1; i < words.length; i++) { // Skip index 0 (sentence-initial)
      const word = words[i]
      // Remove trailing punctuation for the check
      const cleanWord = word.replace(/[,;:'")\]}>]+$/, '').replace(/^['"(\[{<]+/, '')
      if (
        cleanWord.length > 1 &&
        /^[A-Z][a-z]+/.test(cleanWord) &&
        !STOP_WORDS.has(cleanWord.toLowerCase())
      ) {
        addIfNovel(cleanWord)
      }
    }
  }

  // 2. Numbers and dates
  // Dates: various formats (YYYY-MM-DD, MM/DD/YYYY, Month Day Year, etc.)
  const datePatterns = [
    /\b\d{4}-\d{2}-\d{2}\b/g,                         // 2024-01-15
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,                 // 1/15/2024
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+\d{4})?\b/gi, // January 15, 2024
    /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{4})?\b/gi,   // 15 January 2024
  ]
  for (const pattern of datePatterns) {
    const matches = candidateContent.match(pattern) || []
    for (const match of matches) {
      addIfNovel(match)
    }
  }

  // Currency amounts: $100, $1,234.56, etc.
  const currencyMatches = candidateContent.match(/\$[\d,]+(?:\.\d{2})?\b/g) || []
  for (const match of currencyMatches) {
    addIfNovel(match)
  }

  // Standalone numbers with context (age, quantity, etc.)
  const numberMatches = candidateContent.match(/\b\d+(?:\.\d+)?(?:\s*(?:years?|months?|days?|hours?|minutes?|miles?|km|lbs?|kg|ft|cm|percent|%|times?))\b/gi) || []
  for (const match of numberMatches) {
    addIfNovel(match.trim())
  }

  // 3. Technical terms: CamelCase words, acronyms (2+ uppercase letters)
  const camelCaseMatches = candidateContent.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) || []
  for (const match of camelCaseMatches) {
    addIfNovel(match)
  }

  const acronymMatches = candidateContent.match(/\b[A-Z]{2,}\b/g) || []
  for (const match of acronymMatches) {
    if (!STOP_WORDS.has(match.toLowerCase())) {
      addIfNovel(match)
    }
  }

  return novelDetails
}
