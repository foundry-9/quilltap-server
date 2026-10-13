/**
 * The recall search: gather → hydrate → score → select over one
 * {@link RecallQuery}. Every path that searches a character's memories — the
 * turn's head, the proactive pass, the search tool, the Memories API, Carina,
 * the voice rehearsals, the greeting, the replay — runs these same stages with
 * different options.
 *
 * Nothing here stamps `lastAccessedAt`: what a search returns is not what a
 * model saw. `deliver` stamps what was delivered.
 *
 * @module memory/recall/search
 */

import type { EmbeddingResult } from '@/lib/embedding/embedding-service'
import { logger } from '@/lib/logger'
import { gather, type Gathered } from './gather'
import { hydrate, hydrateNeighbours, type HydrateFilters } from './hydrate'
import { buildRecallQuery, type RecallQuery } from './query'
import { score } from './score'
import { select, wantsExpansion } from './select'
import { recallTuningOf, type RecallContext } from './tags'
import { traceStage, type RecallCandidate, type RecallTrace } from './types'

export interface RecallSearchOptions {
  /** How many to return (default 20). */
  limit?: number
  /** An explicit relevance floor; otherwise the embedding provider's default. `0` means none. */
  minScore?: number
  minImportance?: number
  source?: 'AUTO' | 'MANUAL' | 'CONSOLIDATED'
  /** Only rows about this character. */
  aboutCharacterId?: string
  /** Include cold-tier rows (the tool and the Commonplace Book UI). Default false. */
  includeCold?: boolean
  /** Ids to leave out of every source (the replay's `asOf`). */
  excludeIds?: ReadonlySet<string>
  /** The tool path: union and boost verbatim matches of the whole query. */
  literalPhrase?: boolean
  /** The turn's recall context (prompt paths). Absent → the blend alone. */
  recallContext?: RecallContext
  /** The head the caller will take — R6 reads it. */
  headSize?: number
  /** The salience clock, ms. Absent → now. */
  nowMs?: number
  /** Run the text strategy whatever the query holds (the replay). */
  forceText?: boolean
}

export interface RecallSearchResult {
  candidates: RecallCandidate[]
  strategy: Gathered['strategy']
  trace: RecallTrace
}

/** Run the search stages for a built query. Never throws for a vector failure: the text strategy answers. */
export async function searchRecall(
  characterId: string,
  query: RecallQuery,
  options: RecallSearchOptions = {},
  trace: RecallTrace = [],
  label?: string,
): Promise<RecallSearchResult> {
  const limit = options.limit || 20
  const nowMs = options.nowMs ?? Date.now()
  const includeCold = options.includeCold === true
  const filters: HydrateFilters = {
    includeCold,
    excludeIds: options.excludeIds,
    minImportance: options.minImportance,
    source: options.source,
    aboutCharacterId: options.aboutCharacterId,
  }
  const ctx = options.recallContext
  const gatherOptions = {
    limit,
    includeCold,
    excludeIds: options.excludeIds,
    literalPhrase: options.literalPhrase,
    tuning: ctx ? recallTuningOf(ctx) : undefined,
    presentParticipantNames: ctx?.presentParticipantNames,
    minScore: options.minScore,
  }

  const run = async (forceText: boolean): Promise<RecallSearchResult & { empty: boolean }> => {
    const gathered = await gather(characterId, query, { ...gatherOptions, forceText }, trace, label)
    if (gathered.strategy === 'vector' && gathered.hits.length === 0) {
      return { candidates: [], strategy: 'vector', trace, empty: true }
    }
    const hydrated = await hydrate(gathered, filters, trace, label)
    const scored = score(hydrated, gathered, { limit, recallContext: ctx, window: query.window, nowMs }, trace, label)
    const neighbours = wantsExpansion(scored)
      ? await hydrateNeighbours(scored.ranked, limit, characterId, filters)
      : []
    const candidates = select(scored, neighbours, {
      limit,
      headSize: options.headSize,
      queryEmbedding: query.embedding?.embedding ?? null,
      nowMs,
    }, trace, label)
    return { candidates, strategy: gathered.strategy, trace, empty: false }
  }

  if (!options.forceText && query.embedding) {
    try {
      const vector = await run(false)
      if (!vector.empty) return { candidates: vector.candidates, strategy: vector.strategy, trace }
      // An index with nothing to offer (no vectors yet): the text strategy may.
      traceStage(trace, 'gather', { strategy: 'vector', pool: 0, fallback: 'text' }, label)
    } catch (error) {
      logger.warn('[Memory] Semantic search failed, falling back to text search', {
        characterId,
        query: query.text.substring(0, 100),
        error: String(error),
      })
      traceStage(trace, 'gather', { strategy: 'vector', failed: String(error), fallback: 'text' }, label)
    }
  }
  if (!query.text.trim()) return { candidates: [], strategy: 'text', trace }
  const text = await run(true)
  return { candidates: text.candidates, strategy: 'text', trace }
}

/** Options for {@link searchMemories}: the search's, plus the query's own. */
export interface SearchMemoriesOptions extends RecallSearchOptions {
  userId: string
  embeddingProfileId?: string
  /** Event-time window (a plain filter without a recall context). */
  window?: { from: string; to: string } | null
  /** Entity anchors unioned into the pool. */
  anchors?: readonly string[]
  /** Extra embedding probes (≤ 2): each one's top-K joins the pool, a row keeping its best cosine. */
  probes?: readonly string[]
  embeddingMemo?: Map<string, EmbeddingResult>
}

/**
 * Embed `text` once and search: the one-shot form for a path with a ready-made
 * question and no turn signals (the tool, the Memories API, Carina, the voice
 * rehearsals, the greeting).
 */
export async function searchMemories(
  characterId: string,
  text: string,
  options: SearchMemoriesOptions,
): Promise<RecallCandidate[]> {
  const trace: RecallTrace = []
  const query = await buildRecallQuery(
    {
      userId: options.userId,
      embeddingProfileId: options.embeddingProfileId,
      text,
      embeddingMemo: options.embeddingMemo,
      probes: options.probes,
    },
    trace,
  )
  const withExtras: RecallQuery = {
    ...query,
    window: options.window ?? null,
    anchors: [...(options.anchors ?? [])],
  }
  const result = await searchRecall(characterId, withExtras, options, trace)
  return result.candidates
}
