/**
 * Relevance and the recall blend.
 *
 * Relevance is the query cosine, named so every ranking site is greppable.
 * Retrieval ranks by one blended key, `0.75 × relevance + 0.25 × salience`:
 * relevance is the primary key, salience a decaying tie-breaker with no floor.
 * Recall-tag and anti-repetition multipliers are applied to the blend
 * afterwards (`lib/memory/recall-tags.ts`).
 *
 * @module memory/scoring/relevance
 */

/** Relevance of a candidate to a query: the cosine itself. */
export function relevance(cosine: number): number {
  return cosine
}

export const RANKING_RELEVANCE_WEIGHT = 0.75
export const RANKING_PRIORITY_WEIGHT = 0.25

/** The recall blend: `0.75 × relevance + 0.25 × salience`. */
export function computeRankingBlend(cosine: number, salienceValue: number): number {
  return RANKING_RELEVANCE_WEIGHT * relevance(cosine) + RANKING_PRIORITY_WEIGHT * salienceValue
}

/**
 * Default minimum cosine for a memory to be eligible for recall, below which
 * it is dropped before the blend. Neural API embeddings live in a compressed
 * band (~0.25 unrelated, ~0.45–0.75 related); the built-in TF-IDF profile
 * produces much sparser cosines, so the floor is provider-aware.
 */
export const DEFAULT_MIN_COSINE_NEURAL = 0.30
export const DEFAULT_MIN_COSINE_TFIDF = 0.10

/** The relevance floor for an embedding profile's provider (`BUILTIN` is TF-IDF). */
export function defaultMinCosineForProvider(provider: string | undefined | null): number {
  return provider === 'BUILTIN' ? DEFAULT_MIN_COSINE_TFIDF : DEFAULT_MIN_COSINE_NEURAL
}
