/**
 * Stage 2 — gather: the candidate pool, as raw hits.
 *
 * Two strategies yield the same {@link RawHit} shape, so every later stage
 * (floor, window, multipliers, expansion, reservation) applies to both:
 *
 * - **vector** — the index's top-K for the query, unioned with each
 *   retrospective probe's top-K (a memory keeps its best cosine), then the
 *   literal hits: the whole query on the tool path, the turn's entity anchors
 *   on the prompt paths (R4 picks the names that narrow the search). Anchor
 *   hits widen the pool only; they are scored at their raw cosine and face the
 *   floor like any row (R5, bug 202).
 * - **text** — when there is no usable vector (no embedding, or the index holds
 *   no vector of the query's length): phrase and word matches for the query
 *   and each probe, plus the anchors, scored by text match (bug 214).
 *
 * @module memory/recall/gather
 */

import { getRepositories } from '@/lib/repositories/factory'
import type { Memory } from '@/lib/schemas/types'
import { cosineSimilarity } from '@/lib/embedding/embedding-service'
import { getLiteralPhrase } from '@/lib/embedding/literal-boost'
import { logger } from '@/lib/logger'
import { memoryIndex } from '../index-store'
import { defaultMinCosineForProvider } from '../scoring'
import { selectSpecificAnchors } from './tuning'
import type { RecallQuery } from './query'
import type { ResolvedRecallTuning } from './tuning'
import { traceStage, type RawHit, type RecallTrace } from './types'

export interface GatherOptions {
  /** How many the search will return; the vector top-K is three times this. */
  limit: number
  includeCold: boolean
  excludeIds?: ReadonlySet<string>
  /** The tool path: union and boost verbatim matches of the whole query. */
  literalPhrase?: boolean
  /** R4 knobs, when a turn's tuning chooses specific anchors. */
  tuning?: ResolvedRecallTuning
  /** Names of the characters present (R4 skips them as anchors). */
  presentParticipantNames?: readonly string[]
  /** An explicit relevance floor; otherwise the embedding provider's default. */
  minScore?: number
  /** Force the text strategy (the replay's "what the fallback would do"). */
  forceText?: boolean
}

export interface Gathered {
  strategy: 'vector' | 'text'
  hits: RawHit[]
  /** The relevance floor `score` applies (`> 0` for text). */
  minScore: number
  /** The embedding provider, when the vector strategy ran. */
  provider: string | null
  /** The phrase the tool path boosts, when it applies. */
  literalPhrase: string | null
  /** Ids the literal phrases matched; they take the boost when `literalPhrase` is set. */
  literalHitIds: ReadonlySet<string>
}

/**
 * One-time-per-key throttle for the dimension-mismatch warning. A corpus
 * embedded with a different profile than the one now searching degrades recall
 * to text search; said loudly, once per (character, dimension pair).
 */
const dimensionMismatchWarned = new Set<string>()

/** Stop words the text strategy ignores when matching word by word. */
const TEXT_SEARCH_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'is', 'was', 'are', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'that', 'this', 'these',
  'those', 'it', 'its', 'my', 'your', 'his', 'her', 'our', 'their',
  'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
  'not', 'no', 'nor', 'if', 'then', 'than', 'so', 'as', 'about',
  'from', 'into', 'up', 'out', 'off', 'over', 'under', 'again',
  'before', 'after', 'between', 'through',
])

export function significantQueryWords(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !TEXT_SEARCH_STOP_WORDS.has(w))
}

/** Text-match score in [0, 1] for one memory against one query string. */
export function scoreTextMatch(memory: Pick<Memory, 'content' | 'summary' | 'keywords'>, text: string): number {
  const queryLower = text.toLowerCase()
  const queryWords = significantQueryWords(text)
  let score = 0
  const contentLower = memory.content.toLowerCase()
  const summaryLower = memory.summary.toLowerCase()

  if (summaryLower.includes(queryLower)) score += 0.4
  if (contentLower.includes(queryLower)) score += 0.3

  if (queryWords.length > 0) {
    const contentWordMatches = queryWords.filter(w => contentLower.includes(w)).length
    const summaryWordMatches = queryWords.filter(w => summaryLower.includes(w)).length
    score += 0.2 * (contentWordMatches / queryWords.length)
    score += 0.1 * (summaryWordMatches / queryWords.length)
  }

  const matchingKeywords = memory.keywords.filter(kw => queryWords.some(qw => kw.toLowerCase().includes(qw)))
  score += 0.1 * (matchingKeywords.length / Math.max(memory.keywords.length, 1))
  return Math.min(score, 1.0)
}

function cleanAnchors(anchors: readonly string[]): string[] {
  return anchors.map(a => a?.trim()).filter((p): p is string => !!p && p.length >= 2)
}

/**
 * Gather the candidate pool for `query`. The vector strategy runs when the
 * query has an embedding and the index holds vectors of its length; otherwise
 * the text strategy runs.
 */
export async function gather(
  characterId: string,
  query: RecallQuery,
  opts: GatherOptions,
  trace: RecallTrace = [],
  label?: string,
): Promise<Gathered> {
  const embedding = query.embedding
  if (!embedding || opts.forceText) {
    return gatherText(characterId, query, opts, trace, label, embedding ? 'forced' : 'no embedding')
  }

  const indexShape = await memoryIndex.shape(characterId, embedding.embedding.length)
  if (indexShape.size > 0 && indexShape.matching === 0) {
    const warnKey = `${characterId}:${indexShape.dominantDimensions}->${embedding.embedding.length}`
    if (!dimensionMismatchWarned.has(warnKey)) {
      dimensionMismatchWarned.add(warnKey)
      logger.warn('[Memory] Embedding dimension mismatch — recall is degraded to TEXT search (embeddings ignored). Reindex this character or restore the matching embedding profile.', {
        characterId,
        query: query.text.substring(0, 100),
        storedDimensions: indexShape.dominantDimensions,
        queryDimensions: embedding.embedding.length,
        provider: embedding.provider,
      })
    }
    return gatherText(characterId, query, opts, trace, label, 'dimension mismatch')
  }

  const repos = getRepositories()
  const excluded = opts.excludeIds
  const includeCold = opts.includeCold
  const indexSearch = { hotOnly: !includeCold, exclude: excluded, limit: opts.limit * 3 }

  const hits: RawHit[] = (await memoryIndex.search(characterId, embedding.embedding, indexSearch))
    .map(vr => ({ id: vr.id, score: vr.score, via: 'vector' as const }))
  const vectorCount = hits.length

  // Probes: each memory keeps its best cosine; new ids follow in probe order.
  let probeAdded = 0
  const usableProbes = query.probes.filter(p => p.embedding && p.embedding.embedding.length === embedding.embedding.length)
  if (usableProbes.length > 0) {
    const byId = new Map(hits.map(h => [h.id, h]))
    for (const probe of usableProbes) {
      for (const vr of await memoryIndex.search(characterId, probe.embedding!.embedding, indexSearch)) {
        const existing = byId.get(vr.id)
        if (!existing) probeAdded++
        if (!existing || vr.score > existing.score) {
          byId.set(vr.id, { id: vr.id, score: vr.score, via: existing ? existing.via : 'probe' })
        }
      }
    }
    hits.length = 0
    hits.push(...byId.values())
  }

  // Literal hits: the whole query (tool path) and the turn's entity anchors.
  const literalPhrase = opts.literalPhrase ? getLiteralPhrase(query.text) : null
  const anchorPhrases: string[] = []
  if (literalPhrase) anchorPhrases.push(query.text.trim())
  const entityPhrases = cleanAnchors(query.anchors)
  const contentHits = new Map<string, Memory[]>()
  const hitsFor = async (phrase: string): Promise<Memory[]> => {
    let found = contentHits.get(phrase)
    if (!found) {
      found = (await repos.memories.searchByContent(characterId, phrase))
        .filter(m => !excluded?.has(m.id) && (includeCold || m.tier !== 'cold'))
      contentHits.set(phrase, found)
    }
    return found
  }
  let chosenAnchors: string[]
  if (opts.tuning?.specificAnchors) {
    // R4 — prefer the names that narrow the search over the first three.
    const counted: { phrase: string; count: number }[] = []
    for (const phrase of entityPhrases) {
      counted.push({ phrase, count: (await hitsFor(phrase)).length })
    }
    chosenAnchors = selectSpecificAnchors(counted, opts.presentParticipantNames ?? [], 3, {
      minHits: opts.tuning.anchorMinHits,
      order: opts.tuning.anchorOrder,
    })
    logger.debug('[Memory] Specific entity anchors chosen', { characterId, counted, chosen: chosenAnchors })
  } else {
    chosenAnchors = entityPhrases.slice(0, 3)
  }
  anchorPhrases.push(...chosenAnchors)

  const literalHitIds = new Set<string>()
  let anchorAdded = 0
  if (anchorPhrases.length > 0) {
    const direct: Memory[] = []
    const seen = new Set<string>()
    for (const phrase of anchorPhrases) {
      for (const m of await hitsFor(phrase)) {
        literalHitIds.add(m.id)
        if (!seen.has(m.id)) {
          seen.add(m.id)
          direct.push(m)
        }
      }
    }
    const inPool = new Set(hits.map(h => h.id))
    for (const memory of direct) {
      if (inPool.has(memory.id)) continue
      if (memory.embedding && memory.embedding.length === embedding.embedding.length) {
        hits.push({
          id: memory.id,
          score: cosineSimilarity(embedding.embedding, memory.embedding),
          via: literalPhrase ? 'literal' : 'anchor',
          memory,
        })
        anchorAdded++
      }
    }
  }

  const gathered: Gathered = {
    strategy: 'vector',
    hits,
    minScore: opts.minScore ?? defaultMinCosineForProvider(embedding.provider),
    provider: embedding.provider,
    literalPhrase,
    literalHitIds,
  }
  traceStage(trace, 'gather', {
    strategy: 'vector',
    vector: vectorCount,
    probes: usableProbes.length,
    probeAdded,
    anchors: chosenAnchors,
    anchorAdded,
    literal: !!literalPhrase,
    pool: hits.length,
  }, label)
  return gathered
}

/**
 * The text strategy: phrase hits for the query and each probe, word hits when
 * a phrase finds fewer than `limit`, and the anchors (which widen the pool but
 * still need a non-zero text score).
 */
async function gatherText(
  characterId: string,
  query: RecallQuery,
  opts: GatherOptions,
  trace: RecallTrace,
  label: string | undefined,
  reason: string,
): Promise<Gathered> {
  const repos = getRepositories()
  const probes = [query.text, ...query.probes.map(p => p.text)].filter(p => p.trim().length > 0)
  const pool = new Map<string, Memory>()
  const addAll = (found: Memory[]) => {
    for (const m of found) if (!pool.has(m.id)) pool.set(m.id, m)
  }
  for (const probe of probes) {
    const phraseHits = await repos.memories.searchByContent(characterId, probe)
    addAll(phraseHits)
    if (phraseHits.length < opts.limit) {
      for (const word of significantQueryWords(probe)) {
        addAll(await repos.memories.searchByContent(characterId, word))
      }
    }
  }
  const anchors = cleanAnchors(query.anchors).slice(0, 3)
  for (const phrase of anchors) {
    addAll(await repos.memories.searchByContent(characterId, phrase))
  }

  const hits: RawHit[] = [...pool.values()].map(memory => ({
    id: memory.id,
    score: Math.max(...probes.map(probe => scoreTextMatch(memory, probe))),
    via: 'text' as const,
    memory,
  }))
  traceStage(trace, 'gather', { strategy: 'text', reason, probes: probes.length, anchors, pool: hits.length }, label)
  return {
    strategy: 'text',
    hits,
    minScore: 0,
    provider: null,
    literalPhrase: null,
    literalHitIds: new Set(),
  }
}
