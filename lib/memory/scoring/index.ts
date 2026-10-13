/**
 * The three numbers that travel with a memory, one function each:
 *
 * - **relevance** — how well it answers a query (the cosine);
 * - **salience** — how much it is worth saying (importance × time decay, no floor);
 * - **protection** — how much it is worth keeping (the blended housekeeping score).
 *
 * plus the stored `reinforcedImportance` they read, the recall blend, and the
 * importance filters. Every worth-ordering in the memory system goes through
 * `salience` or `protection`; nothing else re-derives a worth score.
 *
 * @module memory/scoring
 */

export {
  reinforcedImportance,
  calculateReinforcedImportance,
  REINFORCED_IMPORTANCE_STEP,
} from './reinforced-importance'
export {
  salience,
  sortBySalience,
  referenceTimeMs,
  SALIENCE_HALF_LIFE_DAYS,
  type SalienceBreakdown,
  type SalienceInput,
} from './salience'
export {
  protection,
  calculateProtectionScore,
  PROTECTION_THRESHOLD,
  DEFAULT_PROTECTION_CONFIG,
  type ProtectionBreakdown,
  type ProtectionInput,
  type ProtectionScoreConfig,
  type ProtectionScoreResult,
} from './protection'
export {
  relevance,
  computeRankingBlend,
  RANKING_RELEVANCE_WEIGHT,
  RANKING_PRIORITY_WEIGHT,
  DEFAULT_MIN_COSINE_NEURAL,
  DEFAULT_MIN_COSINE_TFIDF,
  defaultMinCosineForProvider,
} from './relevance'
export {
  RECALL_MIN_IMPORTANCE,
  TOOL_MIN_IMPORTANCE,
  IMPORTANCE_HIGH,
  IMPORTANCE_LOW,
  filterImportance,
  importanceBand,
  type ImportanceBand,
} from './importance'
export {
  rankForRecall,
  rankByBlend,
  reserveBackgroundSlots,
  byBlendedAfter,
  type RankInput,
} from './rank'
