/**
 * Memory Gate — Pre-Write Similarity Check
 *
 * A four-tier decision at write time, keyed off the thresholds below:
 * - SKIP_NEAR_DUPLICATE: >= NEAR_DUPLICATE_THRESHOLD (0.90) — absorb silently
 * - REINFORCE: >= MERGE_THRESHOLD (0.85) — boost the existing memory
 * - INSERT_RELATED: RELATED_THRESHOLD (0.70) – MERGE_THRESHOLD — link memories
 * - INSERT: below RELATED_THRESHOLD — create a fresh memory
 *
 * This changes the memory system from append-only to append-or-reinforce,
 * preserving signal about repeatedly observed facts.
 *
 * Episodic date guard: "same activity, different occasion" (visited the harbor
 * in spring vs. winter) embeds nearly identically, so when candidate and best
 * match both carry an `occurredAt` more than {@link DATE_GUARD_DAYS} apart, a
 * would-be SKIP_NEAR_DUPLICATE / REINFORCE is downgraded to INSERT_RELATED —
 * distinct occasions must both persist.
 */

import { Memory } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { getCharacterVectorStore } from '@/lib/embedding/vector-store'
import { generateEmbeddingForUser, EmbeddingError } from '@/lib/embedding/embedding-service'
import { trackActivity } from '@/lib/background-jobs/activity-registry'
import { rawQuery } from '@/lib/database/manager'
import { chunkArray, SQLITE_VARIABLE_CHUNK_SIZE } from '@/lib/utils/chunk'
import { logger } from '@/lib/logger'
import { publishRealtime } from '@/lib/realtime/bus'
import { buildMemoryEmbeddingText, type EpisodicAnchorView } from './episodic'
import { calculateReinforcedImportance } from './reinforced-importance'

// =============================================================================
// Constants
// =============================================================================

/**
 * Near-duplicate threshold — at or above this, the candidate is considered an
 * exact-or-near-exact restatement of an existing memory. No new row is
 * written and the existing text is left alone, but the observation still
 * counts: {@link absorbNearDuplicate} bumps the row's reinforcement count, so
 * the facts restated most faithfully are not the ones that never accrue
 * reinforcement.
 */
export const NEAR_DUPLICATE_THRESHOLD = 0.90

/** Duplicate-enough threshold — memories above this are reinforced, not duplicated. */
export const MERGE_THRESHOLD = 0.85

/** Related-but-distinct threshold — memories in this band get linked. */
export const RELATED_THRESHOLD = 0.70

/**
 * Most `[+]` footnote lines a memory may carry. Past this, reinforcement still
 * bumps count/importance and unions entities, but appends no more prose and
 * skips the re-embed — an unbounded tail drifts the row's vector toward a bag
 * of proper nouns.
 */
export const MAX_REINFORCEMENT_FOOTNOTES = 8

/** Top-K results to fetch from vector store during gate check */
const GATE_TOP_K = 5

/** Milliseconds to wait before retrying embedding generation once. */
const EMBEDDING_RETRY_DELAY_MS = 500

/**
 * When candidate and best-match `occurredAt` differ by more than this many
 * days, SKIP_NEAR_DUPLICATE / REINFORCE downgrade to INSERT_RELATED so
 * distinct occasions of the same activity both persist as rows.
 */
export const DATE_GUARD_DAYS = 7

/** True when both timestamps parse and sit more than {@link DATE_GUARD_DAYS} apart. */
export function occasionsAreDistinct(
  candidateOccurredAt: string | null | undefined,
  existingOccurredAt: string | null | undefined,
): boolean {
  if (!candidateOccurredAt || !existingOccurredAt) return false
  const a = Date.parse(candidateOccurredAt)
  const b = Date.parse(existingOccurredAt)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.abs(a - b) > DATE_GUARD_DAYS * 86_400_000
}

// =============================================================================
// Types
// =============================================================================

export type GateDecision =
  | { action: 'INSERT' }
  | { action: 'REINFORCE'; existingMemory: Memory; similarity: number }
  | { action: 'INSERT_RELATED'; relatedMemories: { memory: Memory; similarity: number }[] }
  | { action: 'SKIP_NEAR_DUPLICATE'; existingMemory: Memory; similarity: number }
  | { action: 'SKIP_EMBEDDING_FAILED'; reason: string }

export interface GateResult {
  decision: GateDecision
  embedding: Float32Array | null
  debugInfo: string[]
}

export interface MemoryGateOutcome {
  /** The memory affected by this outcome, or null for SKIP_EMBEDDING_FAILED. For SKIP_NEAR_DUPLICATE this is the existing memory that absorbed the observation. */
  memory: Memory | null
  action:
    | 'INSERT'
    | 'REINFORCE'
    | 'INSERT_RELATED'
    | 'SKIP_GATE'
    | 'SKIP_NEAR_DUPLICATE'
    | 'SKIP_EMBEDDING_FAILED'
  novelDetails?: string[]
  relatedMemoryIds?: string[]
  /** Cosine similarity to the existing memory (for SKIP_NEAR_DUPLICATE). */
  similarity?: number
  /** Human-readable reason (for SKIP_EMBEDDING_FAILED). */
  reason?: string
}

// =============================================================================
// Reinforced Importance Formula
// =============================================================================

// The formula lives in its own module so the memories repository's atomic
// reinforcement write can compute it without importing the gate (bug 182).
export { calculateReinforcedImportance }

// =============================================================================
// Gate Core
// =============================================================================

/**
 * Run the Memory Gate — decide whether to INSERT, REINFORCE, INSERT_RELATED,
 * SKIP_NEAR_DUPLICATE, or SKIP_EMBEDDING_FAILED.
 *
 * 1. Generate embedding for candidate content (one retry on failure).
 * 2. Search character's vector store for similar memories (top-K).
 * 3. Best match >= NEAR_DUPLICATE_THRESHOLD → SKIP_NEAR_DUPLICATE (no write).
 * 4. Best match >= MERGE_THRESHOLD → REINFORCE.
 * 5. Any match in RELATED_THRESHOLD–MERGE_THRESHOLD → INSERT_RELATED.
 * 6. All below RELATED_THRESHOLD → INSERT.
 * 7. If embedding fails after one retry → SKIP_EMBEDDING_FAILED (no write).
 */
export async function runMemoryGate(
  characterId: string,
  candidateContent: string,
  candidateSummary: string,
  _candidateKeywords: string[],
  userId: string,
  embeddingProfileId?: string,
  candidateAnchors?: EpisodicAnchorView
): Promise<GateResult> {
  // Memories formed from a tool call rather than the extraction job have no
  // job row to count them, so the gate registers itself. Re-entrant by kind,
  // so the extraction job's own row is not double-counted; the embedding it
  // mints inside still counts separately under "Emb".
  return trackActivity('memory', () =>
    runMemoryGateInner(
      characterId,
      candidateContent,
      candidateSummary,
      _candidateKeywords,
      userId,
      embeddingProfileId,
      candidateAnchors
    )
  )
}

/** Longest supersession chain the gate will follow to a live digest. */
const MAX_DIGEST_HOPS = 3

/**
 * Gate-side handling of COLD matches (tiers, spec B3).
 *
 * The gate searches both tiers so a cold row still stops re-insertion. What it
 * does with a cold best match depends on why the row is cold:
 * - superseded (`supersededById`): the observation belongs to the digest that
 *   replaced it, so absorption is redirected there. Returns the digest, flagged
 *   `redirected`. A vanished digest falls back to the cold row (today's
 *   behaviour), which is then treated as a non-superseded cold row.
 * - demoted by cap pressure (no `supersededById`): the world asked for it
 *   again, so it is promoted back to hot. Returns the row as it now stands.
 * Hot rows pass through untouched.
 */
async function resolveColdForAbsorb(
  memory: Memory,
  debugInfo: string[],
): Promise<{ memory: Memory; redirected: boolean }> {
  if (memory.tier !== 'cold') return { memory, redirected: false }

  const repos = getRepositories()
  let current = memory
  let redirected = false
  for (let hop = 0; hop < MAX_DIGEST_HOPS && current.tier === 'cold' && current.supersededById; hop++) {
    const [digest] = await repos.memories.findByIds([current.supersededById])
    if (!digest) {
      debugInfo.push(`[Gate] Cold match ${current.id} names missing digest ${current.supersededById}; treating as cold row`)
      logger.debug('[MemoryGate] Superseding digest missing; falling back to cold row', {
        memoryId: current.id,
        supersededById: current.supersededById,
      })
      break
    }
    debugInfo.push(`[Gate] Cold match ${current.id} superseded by digest ${digest.id} → redirecting`)
    current = digest
    redirected = true
  }

  if (current.tier === 'cold' && !current.supersededById) {
    const promoted = await promoteColdMemory(current)
    debugInfo.push(`[Gate] Cold match ${current.id} re-observed → promoted to hot`)
    return { memory: promoted, redirected }
  }
  return { memory: current, redirected }
}

/**
 * Move a cold, non-superseded memory back to the hot tier. In the parent the
 * write lands immediately and the in-memory vector store is re-stamped; in the
 * job child it buffers, and the dispatcher invalidates the parent's store when
 * it commits.
 */
async function promoteColdMemory(memory: Memory): Promise<Memory> {
  const repos = getRepositories()
  await repos.memories.updateTierBulk(memory.characterId, [memory.id], 'hot', { supersededById: null })
  try {
    const store = await getCharacterVectorStore(memory.characterId)
    store.setTier([memory.id], 'hot')
  } catch (error) {
    logger.warn('[MemoryGate] Failed to re-stamp vector tier after promotion', {
      memoryId: memory.id,
      error: String(error),
    })
  }
  logger.debug('[MemoryGate] Promoted cold memory to hot on re-observation', {
    memoryId: memory.id,
    characterId: memory.characterId,
  })
  return { ...memory, tier: 'hot', supersededById: null }
}

/**
 * INSERT_RELATED target for a match: a cold, superseded member is replaced by
 * its live digest; anything else (hot, cold-unsuperseded, digest gone) links
 * as-is. Never writes — linking a new row to a cold row is not a promotion.
 */
async function redirectColdLink(memory: Memory, debugInfo: string[]): Promise<Memory> {
  let current = memory
  const repos = getRepositories()
  for (let hop = 0; hop < MAX_DIGEST_HOPS && current.tier === 'cold' && current.supersededById; hop++) {
    const [digest] = await repos.memories.findByIds([current.supersededById])
    if (!digest) break
    debugInfo.push(`[Gate] Linking to digest ${digest.id} instead of cold member ${current.id}`)
    current = digest
  }
  return current
}

async function runMemoryGateInner(
  characterId: string,
  candidateContent: string,
  candidateSummary: string,
  _candidateKeywords: string[],
  userId: string,
  embeddingProfileId?: string,
  candidateAnchors?: EpisodicAnchorView
): Promise<GateResult> {
  const debugInfo: string[] = []
  // Anchor line included so the gate compares/writes the same vector shape the
  // create path stores (see buildMemoryEmbeddingText).
  const embeddingText = buildMemoryEmbeddingText(candidateSummary, candidateContent, candidateAnchors)

  let embeddingResult: Awaited<ReturnType<typeof generateEmbeddingForUser>>
  try {
    embeddingResult = await generateEmbeddingForUser(embeddingText, userId, embeddingProfileId, { priority: 'background' })
  } catch (firstError) {
    const firstMsg = firstError instanceof EmbeddingError
      ? firstError.message
      : String(firstError)
    debugInfo.push(`[Gate] Embedding attempt 1 failed (${firstMsg}); retrying in ${EMBEDDING_RETRY_DELAY_MS}ms`)

    try {
      await new Promise(resolve => setTimeout(resolve, EMBEDDING_RETRY_DELAY_MS))
      embeddingResult = await generateEmbeddingForUser(embeddingText, userId, embeddingProfileId, { priority: 'background' })
      debugInfo.push('[Gate] Embedding retry succeeded')
    } catch (secondError) {
      const secondMsg = secondError instanceof EmbeddingError
        ? secondError.message
        : String(secondError)
      const reason = `Embedding failed after retry: ${secondMsg}`
      debugInfo.push(`[Gate] ${reason} → SKIP_EMBEDDING_FAILED`)
      logger.warn('[MemoryGate] Skipping memory write — embedding generation failed after retry', {
        characterId,
        userId,
        error: secondMsg,
      })
      return {
        decision: { action: 'SKIP_EMBEDDING_FAILED', reason },
        embedding: null,
        debugInfo,
      }
    }
  }

  const embedding = embeddingResult.embedding
  debugInfo.push(`[Gate] Generated embedding (${embedding.length} dimensions)`)

  const vectorStore = await getCharacterVectorStore(characterId)
  const results = vectorStore.search(embedding, GATE_TOP_K)

  if (results.length === 0) {
    debugInfo.push('[Gate] No existing memories in vector store → INSERT')
    return { decision: { action: 'INSERT' }, embedding, debugInfo }
  }

  // Get full memory data for matched IDs (only the top-K, not the entire corpus)
  const repos = getRepositories()
  const matchedIds = results.map(r => r.id)
  const matchedMemories = await repos.memories.findByIds(matchedIds)
  const memoryMap = new Map(matchedMemories.map(m => [m.id, m]))

  // Find best match
  const bestResult = results[0]
  const bestMemory = memoryMap.get(bestResult.id)

  debugInfo.push(`[Gate] Best match: score=${bestResult.score.toFixed(3)}, id=${bestResult.id}`)

  // Episodic date guard: a near-identical embedding with an occurredAt more
  // than DATE_GUARD_DAYS from the best match is a DIFFERENT OCCASION of the
  // same activity — link, never absorb.
  const distinctOccasion =
    bestMemory !== undefined &&
    bestResult.score >= MERGE_THRESHOLD &&
    occasionsAreDistinct(candidateAnchors?.occurredAt, bestMemory.occurredAt)
  if (distinctOccasion && bestMemory) {
    debugInfo.push(
      `[Gate] Score ${bestResult.score.toFixed(3)} but occurredAt differs by > ${DATE_GUARD_DAYS} days ` +
      `(candidate ${candidateAnchors?.occurredAt}, existing ${bestMemory.occurredAt}) → INSERT_RELATED (date guard)`
    )
    const linkTarget = await redirectColdLink(bestMemory, debugInfo)
    return {
      decision: {
        action: 'INSERT_RELATED',
        relatedMemories: [{ memory: linkTarget, similarity: bestResult.score }],
      },
      embedding,
      debugInfo,
    }
  }

  if (bestResult.score >= NEAR_DUPLICATE_THRESHOLD && bestMemory) {
    debugInfo.push(`[Gate] Score >= ${NEAR_DUPLICATE_THRESHOLD} → SKIP_NEAR_DUPLICATE`)
    const { memory: target } = await resolveColdForAbsorb(bestMemory, debugInfo)
    return {
      decision: {
        action: 'SKIP_NEAR_DUPLICATE',
        existingMemory: target,
        similarity: bestResult.score,
      },
      embedding,
      debugInfo,
    }
  }

  if (bestResult.score >= MERGE_THRESHOLD && bestMemory) {
    debugInfo.push(`[Gate] Score >= ${MERGE_THRESHOLD} → REINFORCE`)
    const { memory: target, redirected } = await resolveColdForAbsorb(bestMemory, debugInfo)
    if (redirected) {
      // A digest is reinforced by count only: no [+] footnote (the next
      // consolidation folds any novel detail in). SKIP_NEAR_DUPLICATE is the
      // count-only absorption path.
      debugInfo.push('[Gate] Reinforcement redirected to digest → count-only absorption')
      return {
        decision: { action: 'SKIP_NEAR_DUPLICATE', existingMemory: target, similarity: bestResult.score },
        embedding,
        debugInfo,
      }
    }
    return {
      decision: {
        action: 'REINFORCE',
        existingMemory: target,
        similarity: bestResult.score,
      },
      embedding,
      debugInfo,
    }
  }

  // Check for related memories in the band
  const rawRelated = results
    .filter(r => r.score >= RELATED_THRESHOLD && r.score < MERGE_THRESHOLD)
    .map(r => ({ memory: memoryMap.get(r.id)!, similarity: r.score }))
    .filter(r => r.memory)
  // A cold, superseded member is linked via its digest; collapse duplicates
  // (several members of one cluster) onto the digest's best similarity.
  const relatedById = new Map<string, { memory: Memory; similarity: number }>()
  for (const match of rawRelated) {
    const target = await redirectColdLink(match.memory, debugInfo)
    const prior = relatedById.get(target.id)
    if (!prior || match.similarity > prior.similarity) {
      relatedById.set(target.id, { memory: target, similarity: match.similarity })
    }
  }
  const relatedMatches = Array.from(relatedById.values())

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
}

// =============================================================================
// Reinforcement
// =============================================================================

/** Number of `[+]` footnote lines already appended to a memory's content. */
export function countReinforcementFootnotes(content: string): number {
  let count = 0
  for (const line of content.split('\n')) {
    if (line.startsWith('[+] ')) count++
  }
  return count
}

/**
 * Append novel details to `content` as `[+]` footnotes, stopping at
 * {@link MAX_REINFORCEMENT_FOOTNOTES}. Returns the new content and the details
 * actually appended (a prefix of `details`, possibly empty).
 */
export function appendCappedFootnotes(
  content: string,
  details: string[],
): { content: string; appended: string[] } {
  const room = Math.max(0, MAX_REINFORCEMENT_FOOTNOTES - countReinforcementFootnotes(content))
  const appended = details.slice(0, room)
  if (appended.length === 0) return { content, appended }
  return { content: `${content}\n${appended.map(d => `[+] ${d}`).join('\n')}`, appended }
}

/**
 * Persist a patch to a memory and return the row as it now stands.
 *
 * Returns null only when the row is genuinely missing (the repository's
 * not-found answer). In the job child a buffered write returns `undefined` —
 * the row is fine, the write simply lands at commit — so the caller gets the
 * patch applied to its own copy instead of a false "update failed".
 */
export async function patchMemory(memory: Memory, patch: Partial<Memory>): Promise<Memory | null> {
  const repos = getRepositories()
  const updated = await repos.memories.updateForCharacter(memory.characterId, memory.id, patch)
  if (updated === null) return null
  if (updated === undefined) {
    logger.debug('[MemoryGate] Memory patch buffered (job child); using local view', {
      memoryId: memory.id,
      fields: Object.keys(patch),
    })
    return { ...memory, ...patch }
  }
  return updated
}

/**
 * Regenerate a memory's embedding from its current summary/content/anchors and
 * write it to both the row and the character's vector store. Best-effort:
 * failures warn and leave the old vector in place.
 */
export async function reembedMemory(
  memory: Memory,
  userId: string,
  embeddingProfileId?: string,
): Promise<boolean> {
  const repos = getRepositories()
  try {
    const embeddingResult = await generateEmbeddingForUser(
      buildMemoryEmbeddingText(memory.summary, memory.content, memory),
      userId,
      embeddingProfileId,
      { priority: 'background' }
    )

    await repos.memories.updateForCharacter(
      memory.characterId,
      memory.id,
      { embedding: embeddingResult.embedding }
    )

    const vectorStore = await getCharacterVectorStore(memory.characterId)
    if (vectorStore.hasVector(memory.id)) {
      await vectorStore.updateVector(memory.id, embeddingResult.embedding)
    } else {
      await vectorStore.addVector(memory.id, embeddingResult.embedding, {
        memoryId: memory.id,
        characterId: memory.characterId,
      })
    }
    await vectorStore.save()
    logger.debug('[MemoryGate] Re-embedded memory', { memoryId: memory.id })
    return true
  } catch (error) {
    logger.warn('[MemoryGate] Failed to re-embed memory', {
      memoryId: memory.id,
      error: String(error),
    })
    return false
  }
}

/**
 * Count one more observation of `memory` and return the row's reinforcement
 * fields as they now stand.
 *
 * The count is incremented atomically against the row at write time
 * (`MemoriesRepository.incrementReinforcement`), never written as an absolute
 * value from the gate's snapshot — two jobs reinforcing the same row would
 * otherwise both write N+1 (bug 182). Returns null when the row is missing. In
 * the job child the write is buffered and replayed by the parent, so the
 * caller gets the snapshot's count plus one as its local view.
 */
export async function countReinforcement(
  memory: Memory,
): Promise<Pick<Memory, 'reinforcementCount' | 'lastReinforcedAt' | 'reinforcedImportance'> | null> {
  const repos = getRepositories()
  const at = new Date().toISOString()
  const counted = await repos.memories.incrementReinforcement(memory.characterId, memory.id, at)
  if (counted === null) return null
  if (counted === undefined) {
    const reinforcementCount = (memory.reinforcementCount ?? 1) + 1
    logger.debug('[MemoryGate] Reinforcement buffered (job child); using local view', {
      memoryId: memory.id,
      reinforcementCount,
    })
    return {
      reinforcementCount,
      lastReinforcedAt: at,
      reinforcedImportance: calculateReinforcedImportance(memory.importance, reinforcementCount),
    }
  }
  return { ...counted, lastReinforcedAt: at }
}

/**
 * Count a near-duplicate re-observation (SKIP_NEAR_DUPLICATE) as reinforcement.
 *
 * The candidate restates the existing memory almost verbatim, so nothing about
 * the row's text or vector changes: no footnotes, no anchor upgrades, no
 * re-embed. Only the reinforcement signal moves — count, lastReinforcedAt,
 * reinforcedImportance — which is what protection and ranking read.
 */
export async function absorbNearDuplicate(existingMemory: Memory): Promise<Memory> {
  const counted = await countReinforcement(existingMemory)
  if (!counted) {
    logger.warn('[MemoryGate] Failed to reinforce near-duplicate memory', {
      memoryId: existingMemory.id,
      characterId: existingMemory.characterId,
    })
    return existingMemory
  }

  logger.debug('[MemoryGate] Near-duplicate absorbed as reinforcement', {
    memoryId: existingMemory.id,
    reinforcementCount: counted.reinforcementCount,
    reinforcedImportance: counted.reinforcedImportance,
  })
  return { ...existingMemory, ...counted }
}

/**
 * Reinforce an existing memory with new observations.
 *
 * 1. Extract novel details from candidate not present in existing memory.
 * 2. Append novel details as footnotes, up to {@link MAX_REINFORCEMENT_FOOTNOTES}.
 * 3. Increment reinforcementCount, update lastReinforcedAt.
 * 4. Recalculate reinforcedImportance.
 * 5. Upgrade episodic anchors when the retelling supplies better ones
 *    (fills a null occurredAt/narrativeTime; unions new entities).
 * 6. Re-embed if content or the anchor line changed — unless the row was
 *    already at the footnote cap, in which case it is not re-embedded.
 * 7. Return updated memory.
 */
export async function reinforceMemory(
  existingMemory: Memory,
  candidateContent: string,
  candidateSummary: string,
  userId: string,
  embeddingProfileId?: string,
  candidateAnchors?: EpisodicAnchorView
): Promise<{ memory: Memory; novelDetails: string[] }> {
  const allNovelDetails = extractNovelDetails(candidateContent, existingMemory.content)
  const atCap = countReinforcementFootnotes(existingMemory.content) >= MAX_REINFORCEMENT_FOOTNOTES

  const { content: newContent, appended: novelDetails } = appendCappedFootnotes(
    existingMemory.content,
    allNovelDetails,
  )
  if (novelDetails.length < allNovelDetails.length) {
    logger.debug('[MemoryGate] Reinforcement footnote cap reached; dropping extra details', {
      memoryId: existingMemory.id,
      offered: allNovelDetails.length,
      appended: novelDetails.length,
      cap: MAX_REINFORCEMENT_FOOTNOTES,
    })
  }

  const contentChanged = newContent !== existingMemory.content

  // The count, lastReinforcedAt and reinforcedImportance are NOT in this
  // patch: they move only through countReinforcement's atomic increment.
  const updateData: Partial<Memory> = {}

  if (contentChanged) {
    updateData.content = newContent
  }

  // Anchor upgrades: a retelling that supplies when/where the original capture
  // lacked should improve the row — today only footnote prose accumulates.
  // Note the date guard upstream already diverted candidates whose occurredAt
  // CONFLICTS with the existing one by > DATE_GUARD_DAYS, so filling a null is
  // safe here. Entities union (bounded) so repeated retellings converge.
  let anchorsChanged = false
  if (candidateAnchors) {
    if (candidateAnchors.occurredAt && !existingMemory.occurredAt) {
      updateData.occurredAt = candidateAnchors.occurredAt
      anchorsChanged = true
    }
    if (candidateAnchors.narrativeTime && !existingMemory.narrativeTime) {
      updateData.narrativeTime = candidateAnchors.narrativeTime
      anchorsChanged = true
    }
    const candidateEntities = (candidateAnchors.entities ?? []).filter(
      (e): e is string => typeof e === 'string' && e.trim().length > 0,
    )
    if (candidateEntities.length > 0) {
      const existingEntities = existingMemory.entities ?? []
      const existingLower = new Set(existingEntities.map(e => e.toLowerCase()))
      const fresh = candidateEntities.filter(e => !existingLower.has(e.toLowerCase()))
      if (fresh.length > 0) {
        const merged = [...existingEntities, ...fresh].slice(0, 12)
        if (merged.length > existingEntities.length) {
          updateData.entities = merged
          anchorsChanged = true
        }
      }
    }
  }

  const counted = await countReinforcement(existingMemory)
  if (!counted) {
    logger.warn('[MemoryGate] Failed to update memory during reinforcement', {
      memoryId: existingMemory.id,
      characterId: existingMemory.characterId,
    })
    return { memory: existingMemory, novelDetails }
  }

  let updatedMemory: Memory = { ...existingMemory, ...counted }
  if (Object.keys(updateData).length > 0) {
    const patched = await patchMemory(updatedMemory, updateData)
    if (!patched) {
      logger.warn('[MemoryGate] Failed to update memory during reinforcement', {
        memoryId: existingMemory.id,
        characterId: existingMemory.characterId,
      })
      return { memory: updatedMemory, novelDetails }
    }
    updatedMemory = { ...patched, ...counted }
  }

  // Re-embed if content or anchors changed (the anchor line is embedded text).
  // Past the footnote cap the row's vector is frozen until consolidation
  // rewrites it — anchors still land on the row, they just don't re-embed.
  if (!atCap && (contentChanged || anchorsChanged)) {
    await reembedMemory(updatedMemory, userId, embeddingProfileId)
  }

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

  return linkedIds
}

// =============================================================================
// Deletion chokepoint — unlink before delete
// =============================================================================

/**
 * Warn-log threshold for single-memory deletions touching an unusually
 * large neighbour set. Either indicates a hub node (interesting) or a bug.
 */
const SINGLE_DELETE_NEIGHBOUR_WARN = 20

/**
 * Warn-log threshold for batch deletions. Batch cascades from large
 * characters or chats are expected; the warn fires when neighbour count
 * outstrips even those.
 */
const BATCH_DELETE_NEIGHBOUR_WARN = 200

interface NeighbourRow {
  id: string
  characterId: string
  relatedMemoryIds: string | null
}

function parseRelatedIds(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/**
 * Delete a single memory and scrub the deleted ID from every neighbour's
 * `relatedMemoryIds`. The single chokepoint for memory deletion — parallel
 * to `createMemoryWithGate` on the write side. Idempotent: if the row is
 * already gone, returns false without touching neighbours.
 *
 * Callers that need to cascade many memories at once should use
 * {@link deleteMemoriesWithUnlinkBatch} — it scans neighbours in a single
 * pass instead of repeating the LIKE filter per ID.
 */
export async function deleteMemoryWithUnlink(memoryId: string): Promise<boolean> {
  const startedAt = Date.now()
  const repos = getRepositories()

  const target = await repos.memories.findById(memoryId)
  if (!target) {
    return false
  }

  // LIKE pre-filter narrows the scan; the quoted UUID inside the pattern
  // prevents partial-UUID collisions across the JSON column.
  const likeParam = `%"${memoryId}"%`
  const neighbours = await rawQuery<NeighbourRow[]>(
    'SELECT id, characterId, relatedMemoryIds FROM memories WHERE relatedMemoryIds LIKE ? AND id != ?',
    [likeParam, memoryId]
  )

  const charactersAffected = new Set<string>()
  for (const neighbour of neighbours) {
    const current = parseRelatedIds(neighbour.relatedMemoryIds)
    if (!current.includes(memoryId)) continue
    const filtered = current.filter(id => id !== memoryId)
    await repos.memories.updateForCharacter(neighbour.characterId, neighbour.id, {
      relatedMemoryIds: filtered,
    })
    charactersAffected.add(neighbour.characterId)
  }

  const deleted = await repos.memories.delete(memoryId)

  const logFields = {
    memoryId,
    neighbourCount: neighbours.length,
    charactersAffected: charactersAffected.size,
    durationMs: Date.now() - startedAt,
  }
  if (neighbours.length >= SINGLE_DELETE_NEIGHBOUR_WARN) {
    logger.warn('[MemoryGate] deleteMemoryWithUnlink touched an unusually large neighbour set', logFields)
  }
  logger.debug('[MemoryGate] deleteMemoryWithUnlink complete', logFields)

  // Collection-wide: this takes a memory id, not a chat id, so there is no
  // narrower hint to give. A no-op from the job child by design — the parent
  // chokepoints announce a child's deletions.
  if (deleted) publishRealtime('memories')

  return deleted
}

/**
 * Batch version of {@link deleteMemoryWithUnlink}. Scans neighbours once
 * against the full doomed set, scrubs every doomed ID from each neighbour's
 * `relatedMemoryIds` in one update per neighbour, then deletes the batch.
 *
 * Use this for cascades: character deletion, chat-wipe, swipe-group cleanup,
 * housekeeping retention sweeps. Calling the single-ID helper in a loop is
 * correct but wastes a full table scan per ID.
 *
 * Returns the number of memory rows actually deleted (the LIKE-filtered
 * neighbour count is logged, not returned).
 */
export async function deleteMemoriesWithUnlinkBatch(
  memoryIds: string[],
  options: {
    /**
     * Rows whose links the caller has just rewritten in this same operation
     * (a merge survivor), keyed by id. The scrub reads these lists instead of
     * the database row: in the job child the database still holds the
     * pre-write row, and scrubbing from it would overwrite the caller's
     * fresher list.
     */
    currentLinks?: ReadonlyMap<string, { characterId: string; relatedMemoryIds: string[] }>
  } = {},
): Promise<number> {
  if (memoryIds.length === 0) return 0

  const startedAt = Date.now()
  const repos = getRepositories()
  const doomedSet = new Set(memoryIds)

  // One-pass scan of every row with a non-empty links array. The OR-of-LIKEs
  // approach grows ugly past ~50 IDs and the in-JS filter keeps the query
  // shape stable regardless of batch size.
  const dbCandidates = await rawQuery<NeighbourRow[]>(
    "SELECT id, characterId, relatedMemoryIds FROM memories WHERE relatedMemoryIds IS NOT NULL AND relatedMemoryIds != '[]'",
    []
  )
  const overrides = options.currentLinks
  const candidates: Array<{ id: string; characterId: string; links: string[] }> = dbCandidates
    .filter(row => !overrides?.has(row.id))
    .map(row => ({ id: row.id, characterId: row.characterId, links: parseRelatedIds(row.relatedMemoryIds) }))
  if (overrides) {
    for (const [id, entry] of overrides) {
      candidates.push({ id, characterId: entry.characterId, links: entry.relatedMemoryIds })
    }
  }

  const charactersAffected = new Set<string>()
  let neighboursTouched = 0
  for (const candidate of candidates) {
    if (doomedSet.has(candidate.id)) continue
    const current = candidate.links
    if (current.length === 0) continue
    const filtered = current.filter(id => !doomedSet.has(id))
    if (filtered.length === current.length) continue
    await repos.memories.updateForCharacter(candidate.characterId, candidate.id, {
      relatedMemoryIds: filtered,
    })
    charactersAffected.add(candidate.characterId)
    neighboursTouched++
  }

  // Group by character so each deletion call carries its proper scope. The
  // by-character split also means we never touch unrelated rows — the
  // repository's bulkDelete is `characterId`-scoped. Chunked because each ID
  // is one bind variable, and a full-wipe cascade can pass more IDs than
  // SQLITE_MAX_VARIABLE_NUMBER allows in a single statement.
  const idsByCharacter = new Map<string, string[]>()
  for (const chunk of chunkArray(memoryIds, SQLITE_VARIABLE_CHUNK_SIZE)) {
    const toResolve = await rawQuery<Array<{ id: string; characterId: string }>>(
      `SELECT id, characterId FROM memories WHERE id IN (${chunk.map(() => '?').join(',')})`,
      chunk
    )
    for (const row of toResolve) {
      const list = idsByCharacter.get(row.characterId) ?? []
      list.push(row.id)
      idsByCharacter.set(row.characterId, list)
    }
  }

  // In the job child, `bulkDelete` is a buffered write and returns nothing —
  // the rows go at commit. Counting `undefined` produced NaN (logged as
  // `deleted: null`), which also disarmed the ineffective-sweep backoff. The
  // ids were resolved against the database just above, so their count is what
  // the commit will remove.
  let deleted = 0
  let countSource: 'repository' | 'resolved-ids' = 'repository'
  for (const [characterId, ids] of idsByCharacter) {
    const result: unknown = await repos.memories.bulkDelete(characterId, ids)
    if (typeof result === 'number' && Number.isFinite(result)) {
      deleted += result
    } else {
      deleted += ids.length
      countSource = 'resolved-ids'
    }
  }

  const logFields = {
    requested: memoryIds.length,
    deleted,
    countSource,
    neighboursTouched,
    charactersAffected: charactersAffected.size,
    durationMs: Date.now() - startedAt,
  }
  if (neighboursTouched >= BATCH_DELETE_NEIGHBOUR_WARN) {
    logger.warn('[MemoryGate] deleteMemoriesWithUnlinkBatch touched an unusually large neighbour set', logFields)
  }
  logger.debug('[MemoryGate] deleteMemoriesWithUnlinkBatch complete', logFields)

  // Collection-wide for the same reason as the single-ID path, and doubly so:
  // a batch can span several chats.
  if (deleted > 0) publishRealtime('memories')

  return deleted
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
