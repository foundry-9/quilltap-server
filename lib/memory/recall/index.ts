/**
 * Recall — a pipeline with a trace (memory refactor §3.8):
 *
 * ```
 * query    buildRecallQuery: the turn's text, signals and ONE embedding
 * gather   vector top-K (+ probes, + anchors) ∪ the text strategy → raw hits
 * hydrate  rows, tier / importance / source / subject filters
 * score    floor · salience · window · rankForRecall
 * select   related expansion · R6 reservation · the cut
 * assemble the turn's pools: archive · recap · head · inter-character · conversations
 * render   the section text (no debug labels)
 * deliver  what reached the model: access stamps · the ring · the debug record
 * ```
 *
 * @module memory/recall
 */

export { buildRecallQuery, recallQueryText, type RecallQuery, type BuildRecallQueryInput, type MemorySearchExtraction } from './query'
export { gather, type Gathered, type GatherOptions } from './gather'
export { hydrate, hydrateNeighbours, passesFilters, type HydrateFilters } from './hydrate'
export { score, type Scored, type ScoreOptions } from './score'
export { select, type SelectOptions } from './select'
export { searchRecall, searchMemories, type RecallSearchOptions, type RecallSearchResult, type SearchMemoriesOptions } from './search'
export {
  assembleRecall,
  emptyRecallBundle,
  sizeMemoryPools,
  PROACTIVE_RECALL_POOL_SIZE,
  type RecallPlan,
  type RecallBundle,
  type PreRecall,
  type MemoryPoolSizing,
} from './assemble'
export {
  renderArchive,
  renderHead,
  renderRelevant,
  renderInterCharacter,
  humanKeywords,
  type RenderedSection,
  type DebugMemoryInfo,
  type DebugInterCharacterMemoryInfo,
  type MemorySubjectContext,
} from './render'
export { deliverRecall, stampAccessed, survivingLines, ringFromDebugLog, withRecallLines, type RecallDelivery } from './deliver'
export { generateMemoryRecap, type MemoryRecapResult, type MemoryRecapRequest } from './recap'
export type { RecallCandidate, RecallTrace, RecallTraceEntry, RenderedLine, RecallPool } from './types'
