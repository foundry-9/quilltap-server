/**
 * Memory Service — semantic and text search over a character's memories,
 * plus the embedding backfill and index reload behind the Memories API.
 *
 * Memories are created through admission (`./admission`, `admitCandidate`),
 * never here.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { Memory } from '@/lib/schemas/types'
import { generateEmbeddingForUser, EmbeddingError, cosineSimilarity, type EmbeddingResult } from '@/lib/embedding/embedding-service'
import {
  applyLiteralBoost,
  containsLiteralPhrase,
  getLiteralPhrase,
} from '@/lib/embedding/literal-boost'
import { memoryIndex, embeddingTextFor } from './index-store'
import { logger } from '@/lib/logger'
import {
  computeRankingBlend,
  defaultMinCosineForProvider,
  filterImportance,
  salience,
} from './scoring'
import { boostGateThreshold, combineRecallMultipliers, recallTuningOf, RELATED_EXPANSION, type RecallContext } from './recall-tags'
import { selectSpecificAnchors } from './recall-tuning'
import { refreshMemoryTimeZone } from './time/calendar-refresh'

/**
 * Options for memory operations
 */
export interface MemoryServiceOptions {
  /** User ID for API access (required for embedding) */
  userId: string
  /** Specific embedding profile ID to use */
  embeddingProfileId?: string
}

/**
 * A query and the vector actually embedded for it. Handed back through
 * `captureQueryEmbedding` so one turn's embedding can serve more than one
 * search (memories, then the character's vault conversation summaries).
 */
export interface SearchQueryEmbedding {
  /** The exact text that was embedded — pass it verbatim to the reusing search. */
  query: string
  /** Unit-length vector for `query`, from the caller's embedding profile. */
  embedding: Float32Array
}

/**
 * Result of a semantic memory search
 */
export interface SemanticSearchResult {
  /** The matching memory */
  memory: Memory
  /** Similarity score (0-1) */
  score: number
  /** Whether embedding was used for search */
  usedEmbedding: boolean
  /** Salience (reinforcedImportance × time decay, no floor) — the worth the
   * retrieval blend uses, so a stale "important" memory decays out of recall.
   * See {@link computeRankingBlend} and `lib/memory/scoring`. */
  salience?: number
  /**
   * Recall-context adjustment record — present only when a `recallContext` was
   * supplied to `searchMemoriesSemantic`. Lets the injector show *why* a memory
   * ranked where it did and lets tests assert on the post-adjustment ordering.
   */
  recallAdjustment?: {
    /** Combined, clamped multiplier applied to the blended score. */
    multiplier: number
    /** Short labels for the adjustments that fired (e.g. `narrow✓`, `past↓`). */
    fired: string[]
    /** Blended ranking score (see computeRankingBlend) before the multiplier. */
    blendedBefore: number
    /** Blended score after the multiplier (the value actually sorted on). */
    blendedAfter: number
  }
}

/**
 * One-time-per-key throttle for the embedding dimension-mismatch warning. When a
 * character's stored vector index was built with a different embedding profile
 * than the one now searching, vector search silently returns nothing and we fall
 * back to text search — a badly degraded relevance path. We surface this loudly
 * (warn level, actionable) but only once per (character, dimension pair) so it is
 * not buried under per-turn spam. Keyed by `${characterId}:${stored}->${query}`.
 */
const dimensionMismatchWarned = new Set<string>()

/** Descending by post-adjustment blended score. */
function byBlendedAfter(a: SemanticSearchResult, b: SemanticSearchResult): number {
  return (b.recallAdjustment?.blendedAfter ?? 0) - (a.recallAdjustment?.blendedAfter ?? 0)
}

/**
 * R6 — reserve up to `fraction` of the head for qualifying background rows.
 * The head becomes the top `headSize − k` ranked rows plus the top `k`
 * background rows (`k` = reserve, or fewer when fewer qualify — unused slots go
 * back to the ranked rows), each part ranked as before and the head re-sorted
 * by score. Everything else follows in score order.
 */
export function reserveBackgroundSlots(
  ranked: SemanticSearchResult[],
  background: SemanticSearchResult[],
  headSize: number,
  fraction: number,
): SemanticSearchResult[] {
  const reserve = Math.floor(headSize * fraction)
  const taken = Math.min(reserve, background.length)
  if (taken === 0) return ranked
  const head = [...ranked.slice(0, headSize - taken), ...background.slice(0, taken)].sort(byBlendedAfter)
  const tail = [...ranked.slice(headSize - taken), ...background.slice(taken)].sort(byBlendedAfter)
  return [...head, ...tail]
}

/**
 * Search memories using semantic similarity
 *
 * Falls back to text-based search if embedding is not available.
 */
export async function searchMemoriesSemantic(
  characterId: string,
  query: string,
  options: MemoryServiceOptions & {
    limit?: number
    minScore?: number
    minImportance?: number
    source?: 'AUTO' | 'MANUAL' | 'CONSOLIDATED'
    /**
     * When true and the trimmed query is ≥ LITERAL_BOOST_MIN_PHRASE_LENGTH,
     * memories whose content or summary contains the query verbatim
     * (case-insensitive) are unioned into the vector-store top-K candidate
     * pool — their embeddings are explicitly scored against the query if
     * they weren't already in the pool — and their cosine score is boosted
     * halfway to 1.0 BEFORE the importance/recency blend. Used by the
     * unified `search` tool; per-turn injectors leave this off.
     */
    applyLiteralPhraseBoost?: boolean
    /**
     * Per-turn recall context. When supplied, the targeting tags
     * (`temporal`/`scope`/`context`) and `projectId` carried on each candidate
     * are read back and turned into bounded, clamped multipliers applied to the
     * final blended score *after* the ranking blend is computed (see
     * `lib/memory/recall-tags.ts`). Absent → ranking is byte-identical to the
     * historical behavior. The `search` tool and tests leave this off.
     */
    recallContext?: RecallContext
    /**
     * Restrict results to memories the searching character holds *about* this
     * other character (`memory.aboutCharacterId === aboutCharacterId`). Used by
     * the per-turn inter-character recall to fill the "relevant about them" half
     * alongside the importance/recency half. Absent → no inter-character filter.
     */
    aboutCharacterId?: string
    /**
     * Event-time window (episodic recall). Two-stage on the injector path
     * (a `recallContext` is present): candidates are filtered to the window
     * first; if fewer than `limit` survive, fall back to the unfiltered pool
     * with window hits taking the bounded ×`occurredWithinWindow` boost in
     * the multiplier loop — never fewer results than an unwindowed search.
     * Without a `recallContext` (tool path), this is a plain hard filter.
     */
    occurredWithin?: { from: string; to: string } | null
    /**
     * Entity strings (place/person/thing names) unioned into the candidate
     * pool via the literal `searchByContent` path, so a verbatim place name
     * buried below the vector store's top-K cap still reaches ranking.
     * Injector-path companion to `applyLiteralPhraseBoost` (which stays
     * tool-only). Anchor hits get no boost and still face the cosine floor:
     * R5 of the recall retuning made related expansion the only exemption
     * (see bug 202).
     */
    entityAnchors?: readonly string[]
    /**
     * Additional embedding probes (retrospective turns only): each is
     * embedded, its vector-store pool unioned with the main query's, and each
     * memory keeps its max cosine across probes. Capped to 2 extras.
     */
    extraProbes?: readonly string[]
    /**
     * Called with the main query's vector the moment it is embedded (never for
     * the `extraProbes`, and never on the text-search fallback). Lets a caller
     * reuse the turn's one embedding for a companion search — the per-turn
     * conversation-summary list in `lib/chat/context-manager.ts` — rather than
     * paying for a second call on the same sentence. A callback that throws is
     * caught and logged; the search itself carries on.
     */
    captureQueryEmbedding?: (captured: SearchQueryEmbedding) => void
    /**
     * Memory ids to leave out of every candidate source — vector pool, extra
     * probes, entity hits and related expansion. The recall-replay harness uses
     * it to drop memories created after the replayed turn (`asOf`), so an old
     * turn is searched against the corpus as it stood then. Filtered inside the
     * vector scan, so the top-K is drawn from what remains.
     */
    excludeMemoryIds?: ReadonlySet<string>
    /**
     * The head size the caller will take from the result. Only R6's background
     * reservation (`recallContext.tuning.backgroundReserve`) reads it.
     */
    headSize?: number
    /**
     * Clock (ms) for the recency decay in each candidate's weight. Absent → now.
     * The recall-replay harness pins it to the replayed turn's clock under
     * `asOf`, so an old turn is weighted as it was then, and repeat runs agree.
     */
    weightClockMs?: number
    /**
     * Reuse embeddings by text across calls (main query and extra probes). The
     * provider's vectors for one text can differ slightly from call to call;
     * the recall-replay harness passes one memo so every run it compares
     * embeds the same vectors. Live recall leaves it off.
     */
    embeddingMemo?: Map<string, EmbeddingResult>
    /**
     * Include cold-tier (archived, superseded) memories. Default false: every
     * recall path reads hot rows only (memory-consolidation-and-tiers.md B2).
     * The `search` tool and the Commonplace Book UI pass true.
     */
    includeCold?: boolean
  }
): Promise<SemanticSearchResult[]> {
  const repos = getRepositories()
  const limit = options.limit || 20
  // The relevance floor is resolved per embedding profile *after* the query is
  // embedded (neural vs TF-IDF cosines distribute very differently). An explicit
  // caller-supplied floor always wins; `undefined` → the provider default. Note
  // we use `??` not `||` so an explicit `0` (caller wants no floor) is honored.
  const explicitMinScore = options.minScore

  // Timing markers — left in at debug level so we can see which stage of a
  // semantic search is slow on big-corpus characters without having to
  // re-instrument after every performance change.
  const t0 = performance.now()

  const embed = async (text: string): Promise<EmbeddingResult> => {
    const memo = options.embeddingMemo
    const key = `${options.embeddingProfileId ?? 'default'}|${text}`
    const cached = memo?.get(key)
    if (cached) return cached
    const result = await generateEmbeddingForUser(text, options.userId, options.embeddingProfileId)
    memo?.set(key, result)
    return result
  }

  // Try semantic search first
  try {
    const embeddingResult = await embed(query)
    const tEmbed = performance.now()

    // Hand the caller the vector we just paid for, so a companion search in the
    // same turn (the per-turn conversation-summary list) can reuse it instead of
    // embedding the same sentence twice. Reported before the dimension guard
    // below: a vector that doesn't match THIS character's memory index may still
    // match the vault's document index, which is built separately.
    if (options.captureQueryEmbedding) {
      try {
        options.captureQueryEmbedding({ query, embedding: embeddingResult.embedding })
      } catch (captureError) {
        // A companion search's bookkeeping must never cost the caller its
        // memories — swallow and carry on with the search itself.
        logger.warn('[Memory] captureQueryEmbedding callback threw; ignoring', {
          characterId,
          error: captureError instanceof Error ? captureError.message : String(captureError),
        })
      }
    }

    // Relevance floor on the raw cosine, applied before the importance/recency
    // blend so a low-cosine memory can't be smuggled into recall by its weight.
    // Profile-aware: a single global floor would silently break either the
    // neural or the TF-IDF scale.
    const minScore = explicitMinScore ?? defaultMinCosineForProvider(embeddingResult.provider)

    const indexShape = await memoryIndex.shape(characterId, embeddingResult.embedding.length)
    const storedDimensions = indexShape.dominantDimensions

    // Check for dimension mismatch before searching — if no stored vector has
    // the query's length (the search embedding profile differs from the one
    // the corpus was embedded with), vector search returns nothing. Fall back
    // to text search immediately rather than silently returning empty
    // results. A corpus part-way through a re-embed searches the vectors that
    // already match.
    if (indexShape.size > 0 && indexShape.matching === 0) {
      const warnKey = `${characterId}:${storedDimensions}->${embeddingResult.embedding.length}`
      if (!dimensionMismatchWarned.has(warnKey)) {
        dimensionMismatchWarned.add(warnKey)
        // Surfaced once per (character, dimension pair): this is a degraded
        // relevance state, not a normal fallback. Memory recall is running on
        // keyword text search, NOT embeddings — reindex this character's
        // embeddings or switch back to the profile the index was built with.
        logger.warn('[Memory] Embedding dimension mismatch — recall is degraded to TEXT search (embeddings ignored). Reindex this character or restore the matching embedding profile.', {
          characterId,
          query: query.substring(0, 100),
          storedDimensions,
          queryDimensions: embeddingResult.embedding.length,
          userId: options.userId,
          embeddingProfileId: options.embeddingProfileId ?? 'default',
          provider: embeddingResult.provider,
        })
      }
      return searchMemoriesText(characterId, query, options)
    }

    // Hot-only unless the caller asked for the archive: cold rows are filtered
    // inside the (brute-force) vector scan, so the top-K is drawn from hot rows.
    const excluded = options.excludeMemoryIds
    const includeCold = options.includeCold === true
    const indexSearch = { hotOnly: !includeCold, exclude: excluded }
    // The ranking knobs: the context's own tuning, else the retuned defaults.
    // The R1 gate's constants are on the neural cosine scale; TF-IDF
    // (`BUILTIN`) cosines distribute very differently, so the gate stays off
    // there until its own scale is derived (recall-multiplier-retuning.md, R1).
    let recallContext = options.recallContext
    if (recallContext && !recallContext.tuning && embeddingResult.provider === 'BUILTIN') {
      recallContext = { ...recallContext, tuning: { ...recallTuningOf(recallContext), boostGate: null } }
      logger.debug('[Memory] TF-IDF embeddings: recall boost gate off', { characterId })
    }
    const tuning = recallContext ? recallTuningOf(recallContext) : undefined
    const weightClockMs = options.weightClockMs

    // Search vectors
    let vectorResults = await memoryIndex.search(characterId, embeddingResult.embedding, {
      ...indexSearch,
      limit: limit * 3, // Get more results to filter
    })

    // Multi-probe union (retrospective turns): embed each extra probe, union
    // its top-K pool with the main query's, keep each memory's max cosine.
    // Bounded cost (≤ 2 extra embeddings), gated to the turns that need it.
    const extraProbes = (options.extraProbes ?? [])
      .map(p => p?.trim())
      .filter((p): p is string => !!p && p.length > 0)
      .slice(0, 2)
    if (extraProbes.length > 0) {
      const byId = new Map(vectorResults.map(vr => [vr.id, vr]))
      for (const probe of extraProbes) {
        try {
          const probeResult = await embed(probe)
          if (probeResult.embedding.length !== embeddingResult.embedding.length) continue
          for (const vr of await memoryIndex.search(characterId, probeResult.embedding, { ...indexSearch, limit: limit * 3 })) {
            const existing = byId.get(vr.id)
            if (!existing || vr.score > existing.score) {
              byId.set(vr.id, vr)
            }
          }
        } catch (probeError) {
          logger.debug('[Memory] Extra probe embedding failed; skipping probe', {
            characterId,
            probe: probe.substring(0, 80),
            error: probeError instanceof Error ? probeError.message : String(probeError),
          })
        }
      }
      vectorResults = [...byId.values()]
    }
    const tVector = performance.now()

    // Hybrid step: union literal text hits into the candidate pool.
    // searchByContent runs case-insensitive regex match against
    // content+summary, so this captures all direct hits regardless of where
    // they ranked in the vector top-K — a buried exact match cannot stay
    // buried because the vector store's candidate cap excluded it. Two
    // sources of literal phrases: the whole query (tool path,
    // `applyLiteralPhraseBoost`) and the turn's entity anchors (injector
    // path) — a verbatim place name must not be lost to the top-K cap. The
    // union widens the pool only: anchor hits are scored at their raw cosine
    // and face the floor like any other row (R5; bug 202).
    const literalPhrase = options.applyLiteralPhraseBoost
      ? getLiteralPhrase(query)
      : null
    const anchorPhrases: string[] = []
    if (literalPhrase) {
      anchorPhrases.push(query.trim())
    }
    const entityPhrases = (options.entityAnchors ?? [])
      .map(entity => entity?.trim())
      .filter((p): p is string => !!p && p.length >= 2)
    // Content hits per phrase, fetched once and reused by the union below.
    const contentHits = new Map<string, Memory[]>()
    const hitsFor = async (phrase: string): Promise<Memory[]> => {
      let hits = contentHits.get(phrase)
      if (!hits) {
        hits = (await repos.memories.searchByContent(characterId, phrase))
          .filter(m => !excluded?.has(m.id) && (includeCold || m.tier !== 'cold'))
        contentHits.set(phrase, hits)
      }
      return hits
    }
    if (tuning?.specificAnchors) {
      // R4 — prefer the names that narrow the search over the first three.
      const counted: { phrase: string; count: number }[] = []
      for (const phrase of entityPhrases) {
        counted.push({ phrase, count: (await hitsFor(phrase)).length })
      }
      const chosen = selectSpecificAnchors(counted, recallContext?.presentParticipantNames ?? [], 3, {
        minHits: tuning.anchorMinHits,
        order: tuning.anchorOrder,
      })
      logger.debug('[Memory] Specific entity anchors chosen', { characterId, counted, chosen })
      anchorPhrases.push(...chosen)
    } else {
      anchorPhrases.push(...entityPhrases.slice(0, 3))
    }
    const literalHitIds = new Set<string>()
    let augmentedVectorResults = vectorResults

    if (anchorPhrases.length > 0) {
      const directHitMemories: Memory[] = []
      const directSeen = new Set<string>()
      for (const phrase of anchorPhrases) {
        const hits = await hitsFor(phrase)
        for (const m of hits) {
          literalHitIds.add(m.id)
          if (!directSeen.has(m.id)) {
            directSeen.add(m.id)
            directHitMemories.push(m)
          }
        }
      }
      const inVectorPool = new Set(vectorResults.map(vr => vr.id))
      const missingDirectHits = directHitMemories.filter(
        m => !inVectorPool.has(m.id),
      )
      if (missingDirectHits.length > 0) {
        const extras: typeof vectorResults = []
        for (const memory of missingDirectHits) {
          if (
            memory.embedding &&
            memory.embedding.length === embeddingResult.embedding.length
          ) {
            const score = cosineSimilarity(embeddingResult.embedding, memory.embedding)
            extras.push({
              id: memory.id,
              score,
              metadata: { memoryId: memory.id, characterId },
            })
          }
        }
        if (extras.length > 0) {
          augmentedVectorResults = [...vectorResults, ...extras]
        }
      }
    }

    if (augmentedVectorResults.length > 0) {
      // Hydrate only the matched memories. The previous version called
      // findByCharacterId here, which decrypted and Zod-validated the whole
      // corpus (20k+ rows on heavy characters) just to pluck ~60 hits out of
      // a Map. The Memory Gate read path already uses this shape — see
      // lib/memory/memory-gate.ts findByIds(matchedIds).
      const matchedIds = augmentedVectorResults.map(vr => vr.id)
      const memories = await repos.memories.findByIds(matchedIds)
      const memoryMap = new Map(memories.map(m => [m.id, m]))
      // Raw cosine per candidate, before any literal boost — R1 gates on it.
      const rawCosine = new Map(augmentedVectorResults.map(vr => [vr.id, vr.score]))

      let results: SemanticSearchResult[] = augmentedVectorResults
        .map(vr => {
          const memory = memoryMap.get(vr.id)
          if (!memory) return null
          if (!includeCold && memory.tier === 'cold') return null
          // Boost the cosine score (BEFORE the importance/recency blend) for
          // any memory that scored a literal-phrase hit. We re-check the body
          // here on top of literalHitIds so memories already in the vector
          // pool also get the boost without an extra DB roundtrip.
          const literalHit = literalPhrase
            ? literalHitIds.has(memory.id) ||
              containsLiteralPhrase(memory.content, literalPhrase) ||
              containsLiteralPhrase(memory.summary, literalPhrase)
            : false
          const cosineScore = literalHit ? applyLiteralBoost(vr.score) : vr.score
          return {
            memory,
            score: cosineScore,
            usedEmbedding: true,
            salience: salience(memory, { nowMs: weightClockMs }).salience,
          } as SemanticSearchResult
        })
        .filter((r): r is SemanticSearchResult => r !== null)
        .filter(r => r.score >= minScore)

      // Apply additional filters
      if (options.minImportance !== undefined) {
        results = results.filter(r => filterImportance(r.memory) >= options.minImportance!)
      }
      if (options.source) {
        results = results.filter(r => r.memory.source === options.source)
      }
      if (options.aboutCharacterId) {
        results = results.filter(r => r.memory.aboutCharacterId === options.aboutCharacterId)
      }

      // R1's reference point: the best raw cosine in the floor-filtered pool.
      const bestCosine = results.reduce((best, r) => Math.max(best, rawCosine.get(r.memory.id) ?? r.score), 0)
      const relevanceOf = (r: SemanticSearchResult) => ({
        cosine: rawCosine.get(r.memory.id) ?? r.score,
        bestCosine,
      })
      // R6 needs the out-of-window remainder when the window turns hard.
      let outOfWindow: SemanticSearchResult[] = []

      // Event-time window (episodic recall) — two-stage on the injector path:
      // filter to the window first; if fewer than `limit` survive, fall back
      // to the unfiltered pool and let window hits take the bounded
      // ×occurredWithinWindow boost inside the one multiplier loop instead.
      // Never fewer results than an unwindowed search. Tool path (no
      // recallContext): a plain hard filter — the caller asked for a window.
      let effectiveRecallContext = recallContext
      if (options.occurredWithin) {
        const from = Date.parse(options.occurredWithin.from)
        const to = Date.parse(options.occurredWithin.to)
        if (Number.isFinite(from) && Number.isFinite(to) && from <= to) {
          const inWindow = (r: SemanticSearchResult): boolean => {
            const t = Date.parse(r.memory.occurredAt ?? r.memory.createdAt)
            return Number.isFinite(t) && t >= from && t <= to
          }
          const windowHits = results.filter(inWindow)
          if (!recallContext) {
            results = windowHits
          } else if (windowHits.length >= limit) {
            outOfWindow = results.filter(r => !inWindow(r))
            results = windowHits
          } else {
            effectiveRecallContext = {
              ...recallContext,
              occurredWithin: options.occurredWithin,
            }
          }
        }
      }

      // Blended ranking key (see computeRankingBlend: RELEVANCE·cosine +
      // PRIORITY·salience). The blend itself is never modified — when a
      // recallContext is supplied, the targeting-tag adjustments are bounded,
      // clamped multipliers applied to this blended score *after* it is
      // computed (see lib/memory/recall-tags.ts), so semantic relevance and
      // recency keep their relative footing and each adjustment is auditable
      // in isolation. No recallContext → the exact historical sort,
      // byte-for-byte.
      if (effectiveRecallContext) {
        const recallContext = effectiveRecallContext
        const adjust = (pool: SemanticSearchResult[], extraFired: string[] = []): SemanticSearchResult[] => {
          const out: SemanticSearchResult[] = []
          for (const r of pool) {
            const blendedBefore = computeRankingBlend(r.score, r.salience ?? 0)
            const adj = combineRecallMultipliers(r.memory, recallContext, relevanceOf(r))
            if (adj.exclude) {
              continue
            }
            const blendedAfter = blendedBefore * adj.multiplier
            r.recallAdjustment = { multiplier: adj.multiplier, fired: [...adj.fired, ...extraFired], blendedBefore, blendedAfter }
            out.push(r)
          }
          return out.sort(byBlendedAfter)
        }
        const adjusted = adjust(results)

        // Item 5 — one-hop related-memory expansion. After the top hits are
        // ranked, pull each top hit's strongly-linked neighbors in as low-cost
        // extra candidates (capped), score them against the same query embedding,
        // run them through the same blend + multipliers, and re-rank the union.
        // This catches the memory that's relevant by association but didn't clear
        // the embedding threshold directly — the classic RAG miss. Only runs when
        // the caller opts in via recallContext, since it costs one extra batched
        // hydration.
        if (recallContext.expandRelated) {
          const expanded = await expandRelatedMemories(
            adjusted,
            limit,
            embeddingResult.embedding,
            recallContext,
            { minImportance: options.minImportance, source: options.source, excludeMemoryIds: excluded, includeCold },
            characterId,
            bestCosine,
            weightClockMs,
          )
          results = expanded
        } else {
          results = adjusted
        }

        // R6 — when the window filtered hard, keep room in the head for
        // out-of-window background that clears the gate at full strength.
        const gate = tuning?.boostGate
        if (gate && tuning.backgroundReserve > 0 && outOfWindow.length > 0 && options.headSize) {
          const threshold = boostGateThreshold(gate, bestCosine)
          // Expansion may already have pulled an out-of-window row in.
          const present = new Set(results.map(r => r.memory.id))
          const background = adjust(
            outOfWindow.filter(r => !present.has(r.memory.id) && relevanceOf(r).cosine >= threshold),
            ['bg↺'],
          )
          logger.debug('[Memory] Background reservation (R6)', {
            characterId,
            threshold,
            qualifying: background.length,
            reserve: Math.floor(options.headSize * tuning.backgroundReserve),
          })
          results = reserveBackgroundSlots(results, background, options.headSize, tuning.backgroundReserve)
        }
      } else {
        results.sort((a, b) => {
          const finalScoreA = computeRankingBlend(a.score, a.salience ?? 0)
          const finalScoreB = computeRankingBlend(b.score, b.salience ?? 0)
          return finalScoreB - finalScoreA
        })
      }

      const tDone = performance.now()

      return results.slice(0, limit)
    }
  } catch (error) {
    logger.warn(`[Memory] Semantic search failed, falling back to text search`, { characterId, query: query.substring(0, 100), userId: options.userId, error: String(error) })
  }

  // Fallback to text-based search
  return searchMemoriesText(characterId, query, options)
}

/**
 * Item 5 — one-hop related-memory expansion.
 *
 * Given the already-ranked candidate pool (`ranked`, sorted by post-adjustment
 * blended score), pull the strongly-linked neighbors of the top hits in as extra
 * candidates, score them against the same query embedding, run them through the
 * same blend + recall multipliers, union them with the pool, and re-rank.
 *
 * Bounded on every axis so a corpus-heavy character can't balloon the candidate
 * set: only the top `limit` hits seed neighbors, at most {@link RELATED_EXPANSION}
 * `.maxPerHit` per seed and `.maxTotal` overall. Neighbors already in the pool are
 * skipped; neighbors without a dimension-matching embedding can't be cosine-scored
 * and are skipped; the same `minImportance`/`source` filters and cross-project
 * exclusion that gate the main pool apply here too. `minScore` is intentionally
 * NOT re-applied — a low-cosine neighbor relevant purely by association is the
 * whole point of expansion.
 */
async function expandRelatedMemories(
  ranked: SemanticSearchResult[],
  limit: number,
  queryEmbedding: ArrayLike<number>,
  recallContext: RecallContext,
  filters: { minImportance?: number; source?: 'AUTO' | 'MANUAL' | 'CONSOLIDATED'; excludeMemoryIds?: ReadonlySet<string>; includeCold?: boolean },
  characterId: string,
  bestCosine: number,
  weightClockMs?: number,
): Promise<SemanticSearchResult[]> {
  const repos = getRepositories()
  const inPool = new Set(ranked.map(r => r.memory.id))

  // Collect capped neighbor ids from the top hits only.
  const neighborIds: string[] = []
  const neighborSet = new Set<string>()
  for (const seed of ranked.slice(0, limit)) {
    let pulledFromSeed = 0
    for (const neighborId of seed.memory.relatedMemoryIds ?? []) {
      if (neighborIds.length >= RELATED_EXPANSION.maxTotal) break
      if (pulledFromSeed >= RELATED_EXPANSION.maxPerHit) break
      if (inPool.has(neighborId) || neighborSet.has(neighborId)) continue
      if (filters.excludeMemoryIds?.has(neighborId)) continue
      neighborSet.add(neighborId)
      neighborIds.push(neighborId)
      pulledFromSeed++
    }
    if (neighborIds.length >= RELATED_EXPANSION.maxTotal) break
  }

  if (neighborIds.length === 0) {
    return ranked
  }

  const neighbors = await repos.memories.findByIds(neighborIds)
  const survivors: SemanticSearchResult[] = []
  for (const memory of neighbors) {
    // Character-scope + filter guards mirror the main pool.
    if (memory.characterId !== characterId) continue
    if (!filters.includeCold && memory.tier === 'cold') continue
    if (filters.minImportance !== undefined && filterImportance(memory) < filters.minImportance) continue
    if (filters.source && memory.source !== filters.source) continue
    if (!memory.embedding || memory.embedding.length !== queryEmbedding.length) continue

    const cosineScore = cosineSimilarity(queryEmbedding, memory.embedding)
    const memorySalience = salience(memory, { nowMs: weightClockMs }).salience
    const blendedBefore = computeRankingBlend(cosineScore, memorySalience)
    // Gated on its own cosine like any candidate (R1): association may earn a
    // neighbour its place in the pool, but not a boost past better matches.
    const adj = combineRecallMultipliers(memory, recallContext, { cosine: cosineScore, bestCosine })
    if (adj.exclude) continue
    const blendedAfter = blendedBefore * adj.multiplier
    survivors.push({
      memory,
      score: cosineScore,
      usedEmbedding: true,
      salience: memorySalience,
      recallAdjustment: { multiplier: adj.multiplier, fired: [...adj.fired, 'related↗'], blendedBefore, blendedAfter },
    })
  }

  if (survivors.length === 0) {
    return ranked
  }

  const union = [...ranked, ...survivors]
  union.sort(byBlendedAfter)
  return union
}

/**
 * Fire-and-forget bulk update of lastAccessedAt for memories a consumer
 * actually USED — whispered into a prompt, handed to a model as tool output,
 * shown to an answerer. Search itself no longer stamps anything: the dynamic
 * head over-fetches ~3× what it shows, and stamping every candidate left 83%
 * of a corpus "recently accessed", so the recent-access protection bonus no
 * longer discriminated.
 *
 * Character-scoped bulk update so a stale id list cannot affect other
 * characters. Errors are swallowed at warn level — a missed access bump
 * shouldn't fail a chat turn.
 */
export function markMemoriesAccessed(characterId: string, memoryIds: string[]): void {
  const ids = Array.from(new Set(memoryIds.filter(id => typeof id === 'string' && id.length > 0)))
  if (ids.length === 0) return
  logger.debug('[Memory] Marking memories accessed', { characterId, count: ids.length })
  const repos = getRepositories()
  repos.memories.updateAccessTimeBulk(characterId, ids).catch(err => {
    logger.warn('[Memory] Failed to bump lastAccessedAt for used memories', {
      characterId,
      count: ids.length,
      error: err instanceof Error ? err.message : String(err),
    })
  })
}

/**
 * Text-based memory search (fallback when embeddings unavailable)
 *
 * Searches for the full query phrase first, then broadens to individual
 * significant words if the full phrase doesn't match enough results.
 * This is critical when this function is the fallback for a failed
 * semantic search (e.g. dimension mismatch).
 */
async function searchMemoriesText(
  characterId: string,
  query: string,
  options: Parameters<typeof searchMemoriesSemantic>[2],
): Promise<SemanticSearchResult[]> {
  const repos = getRepositories()
  const limit = options.limit || 20
  const excluded = options.excludeMemoryIds
  const includeCold = options.includeCold === true
  const weightClockMs = options.weightClockMs

  // Bug 214: the fallback honours the same candidate options as the vector
  // path — exclusions, extra probes, entity anchors, the event-time window,
  // the recall multipliers and the replay clock. The text score is not a
  // cosine, so R1's boost gate (whose constants are on the neural cosine
  // scale) is switched off here, as it is for TF-IDF embeddings.
  const probes = [query, ...(options.extraProbes ?? [])
    .map(p => p?.trim())
    .filter((p): p is string => !!p && p.length > 0)
    .slice(0, 2)]
  const entityPhrases = (options.entityAnchors ?? [])
    .map(entity => entity?.trim())
    .filter((p): p is string => !!p && p.length >= 2)
    .slice(0, 3)

  const pool = new Map<string, Memory>()
  const addAll = (hits: Memory[]) => {
    for (const m of hits) {
      if (!pool.has(m.id)) pool.set(m.id, m)
    }
  }

  for (const probe of probes) {
    // Full-phrase search first, then per-word when it found too few.
    const phraseHits = await repos.memories.searchByContent(characterId, probe)
    addAll(phraseHits)
    if (phraseHits.length < limit) {
      for (const word of significantQueryWords(probe)) {
        addAll(await repos.memories.searchByContent(characterId, word))
      }
    }
  }
  // Entity anchors widen the pool only; they still need a non-zero text score.
  for (const phrase of entityPhrases) {
    addAll(await repos.memories.searchByContent(characterId, phrase))
  }

  let memories = [...pool.values()]

  // Apply filters
  if (excluded && excluded.size > 0) {
    memories = memories.filter(m => !excluded.has(m.id))
  }
  if (!includeCold) {
    memories = memories.filter(m => m.tier !== 'cold')
  }
  if (options.minImportance !== undefined) {
    memories = memories.filter(m => filterImportance(m) >= options.minImportance!)
  }
  if (options.source) {
    memories = memories.filter(m => m.source === options.source)
  }
  if (options.aboutCharacterId) {
    memories = memories.filter(m => m.aboutCharacterId === options.aboutCharacterId)
  }

  // Score each memory by its best text match across the query and probes.
  let results: SemanticSearchResult[] = memories
    .map(memory => {
      const score = Math.max(...probes.map(probe => scoreTextMatch(memory, probe)))
      return {
        memory,
        score: Math.min(score, 1.0),
        usedEmbedding: false,
        salience: salience(memory, { nowMs: weightClockMs }).salience,
      } as SemanticSearchResult
    })
    // Filter out zero-score results (no words matched at all)
    .filter(r => r.score > 0)

  // Event-time window — the same two-stage rule as the vector path: a hard
  // filter without a recallContext (tool path); on the injector path, hard only
  // when enough hits survive, else the bounded window boost.
  let effectiveRecallContext: RecallContext | undefined = options.recallContext
    ? {
        ...options.recallContext,
        tuning: { ...recallTuningOf(options.recallContext), boostGate: null },
      }
    : undefined
  if (options.occurredWithin) {
    const from = Date.parse(options.occurredWithin.from)
    const to = Date.parse(options.occurredWithin.to)
    if (Number.isFinite(from) && Number.isFinite(to) && from <= to) {
      const inWindow = (r: SemanticSearchResult): boolean => {
        const t = Date.parse(r.memory.occurredAt ?? r.memory.createdAt)
        return Number.isFinite(t) && t >= from && t <= to
      }
      const windowHits = results.filter(inWindow)
      if (!effectiveRecallContext || windowHits.length >= limit) {
        results = windowHits
      } else {
        effectiveRecallContext = { ...effectiveRecallContext, occurredWithin: options.occurredWithin }
      }
    }
  }

  if (effectiveRecallContext) {
    const recallContext = effectiveRecallContext
    const bestScore = results.reduce((best, r) => Math.max(best, r.score), 0)
    const adjusted: SemanticSearchResult[] = []
    for (const r of results) {
      const blendedBefore = computeRankingBlend(r.score, r.salience ?? 0)
      const adj = combineRecallMultipliers(r.memory, recallContext, { cosine: r.score, bestCosine: bestScore })
      if (adj.exclude) continue
      const blendedAfter = blendedBefore * adj.multiplier
      r.recallAdjustment = { multiplier: adj.multiplier, fired: adj.fired, blendedBefore, blendedAfter }
      adjusted.push(r)
    }
    results = adjusted.sort(byBlendedAfter)
  } else {
    // Combine text score with the decaying ranking weight for final ordering.
    results.sort((a, b) => {
      const finalScoreA = computeRankingBlend(a.score, a.salience ?? 0)
      const finalScoreB = computeRankingBlend(b.score, b.salience ?? 0)
      return finalScoreB - finalScoreA
    })
  }

  logger.debug('[Memory] Text-search fallback ranked', {
    characterId,
    candidates: pool.size,
    returned: Math.min(results.length, limit),
    probes: probes.length,
    entityAnchors: entityPhrases.length,
    excluded: excluded?.size ?? 0,
    windowed: !!options.occurredWithin,
    recallContext: !!options.recallContext,
    pinnedClock: weightClockMs !== undefined,
  })

  return results.slice(0, limit)
}

/** Stop words the text-search fallback ignores when matching word by word. */
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

function significantQueryWords(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !TEXT_SEARCH_STOP_WORDS.has(w))
}

/** Text-match score in [0, 1] for one memory against one query string. */
function scoreTextMatch(memory: Memory, text: string): number {
  const queryLower = text.toLowerCase()
  const queryWords = significantQueryWords(text)
  let score = 0
  const contentLower = memory.content.toLowerCase()
  const summaryLower = memory.summary.toLowerCase()

  // Exact full-phrase match in summary is highest score
  if (summaryLower.includes(queryLower)) {
    score += 0.4
  }
  // Exact full-phrase match in content
  if (contentLower.includes(queryLower)) {
    score += 0.3
  }

  // Per-word matching in content and summary
  if (queryWords.length > 0) {
    const contentWordMatches = queryWords.filter(w => contentLower.includes(w)).length
    const summaryWordMatches = queryWords.filter(w => summaryLower.includes(w)).length
    // Score based on proportion of query words matched
    score += 0.2 * (contentWordMatches / queryWords.length)
    score += 0.1 * (summaryWordMatches / queryWords.length)
  }

  // Keyword matches
  const matchingKeywords = memory.keywords.filter(kw =>
    queryWords.some(qw => kw.toLowerCase().includes(qw))
  )
  score += 0.1 * (matchingKeywords.length / Math.max(memory.keywords.length, 1))
  return score
}

/**
 * Generate embeddings for memories that don't have them yet
 *
 * Useful for backfilling existing memories or after enabling embeddings.
 */
export async function generateMissingEmbeddings(
  characterId: string,
  options: MemoryServiceOptions & {
    onProgress?: (processed: number, total: number, current: Memory) => void
  }
): Promise<{ processed: number; failed: number; skipped: number }> {
  const repos = getRepositories()

  // Get all memories without embeddings
  const memories = await repos.memories.findByCharacterId(characterId)
  const memoriesWithoutEmbeddings = memories.filter(
    m => !m.embedding || m.embedding.length === 0
  )

  let processed = 0
  let failed = 0
  let skipped = 0

  // Anchor dates render on the instance's memory calendar.
  const memoryTimeZone = await refreshMemoryTimeZone()

  for (const memory of memoriesWithoutEmbeddings) {
    try {
      options.onProgress?.(processed + failed + skipped, memoriesWithoutEmbeddings.length, memory)

      const embeddingResult = await generateEmbeddingForUser(
        embeddingTextFor(memory, memoryTimeZone),
        options.userId,
        options.embeddingProfileId,
        { priority: 'background' }
      )

      // Row and index in one call; the row's tier rides with the vector.
      await memoryIndex.upsert(characterId, [
        { id: memory.id, embedding: embeddingResult.embedding, tier: memory.tier === 'cold' ? 'cold' : 'hot' },
      ])
      processed++
    } catch (error) {
      logger.warn(`[Memory] Failed to generate embedding for memory ${memory.id}`, { characterId, memoryId: memory.id, userId: options.userId, error: String(error) })
      failed++
    }
  }

  logger.debug('[Memory] Backfilled missing embeddings', { characterId, processed, failed, skipped })
  return { processed, failed, skipped }
}

/**
 * Rebuild a character's vector index.
 *
 * The rows are the index (`memories.embedding` + `memories.tier`); the
 * in-process store is only a cache of them. Rebuilding drops the cache and
 * reads the rows again, so the tiers come with the vectors (bug 205 cannot
 * recur). Reports how many vectors the reloaded index holds, and how many of
 * the character's rows have none (those need `generate-embeddings`).
 */
export async function rebuildVectorIndex(
  characterId: string,
): Promise<{ indexed: number; failed: number }> {
  memoryIndex.reload(characterId)
  const entries = await memoryIndex.entries(characterId)
  const coldIndexed = entries.filter(e => e.metadata.tier === 'cold').length
  const failed = await getRepositories().memories.countWithoutEmbedding(characterId)

  logger.debug('[Memory] Rebuilt vector index from memory rows', {
    characterId,
    indexed: entries.length,
    coldIndexed,
    withoutEmbedding: failed,
  })

  return { indexed: entries.length, failed }
}
