/**
 * Memory System Module
 * Sprint 2+: Memory System Implementation
 *
 * This module provides memory management functionality for characters,
 * including automatic memory extraction, summarization, and context management.
 */

// Cheap LLM Tasks
export {
  extractSelfMemoriesFromTurn,
  extractOtherMemoriesFromTurn,
  summarizeChat,
  titleChat,
  updateContextSummary,
  describeAttachment,
  batchExtractMemories,
  considerTitleUpdate,
  deriveSceneContext,
  renderSelfCanonBlock,
  renderOtherCanonBlock,
  loadCanonForSelf,
  loadCanonForSelfWithCommonplace,
  loadCanonForObserverAboutSubject,
  loadCommonplaceCanon,
  NO_CANON_FALLBACK,
  CANON_BLOCK_TOKEN_CAP,
  type MemoryCandidate,
  type ChatMessage,
  type Attachment,
  type CheapLLMTaskResult,
  type DeriveSceneContextInput,
  type CanonSource,
  type SelfCanon,
} from './cheap-llm-tasks'

// Memory Processor (per-turn extraction)
export {
  processTurnForMemory,
  type TurnMemoryExtractionContext,
  type TurnMemoryProcessingResult,
  type TurnTranscript,
  type TurnCharacterSlice,
} from './memory-processor'

// Format Utilities
export { formatNameWithPronouns } from './format-utils'

// Housekeeping (Sprint 6: Memory Cleanup)
export {
  runHousekeeping,
  getHousekeepingPreview,
  needsHousekeeping,
  type HousekeepingOptions,
  type HousekeepingResult,
  type HousekeepingDetail,
} from './housekeeping'

// Memory Gate (Pre-Write Similarity Check)
export {
  runMemoryGate,
  reinforceMemory,
  linkRelatedMemories,
  extractNovelDetails,
  calculateReinforcedImportance,
  NEAR_DUPLICATE_THRESHOLD,
  MERGE_THRESHOLD,
  RELATED_THRESHOLD,
  type GateDecision,
  type GateResult,
  type MemoryGateOutcome,
} from './memory-gate'

// Memory Recap (Chat Start / Character Join)
export {
  generateMemoryRecap,
  type MemoryRecapResult,
} from './memory-recap'

// Memory Consolidation (digests + hot/cold tiers)
export {
  runConsolidation,
  CONSOLIDATION_LOAD_PAGE_SIZE,
  CONSOLIDATION_MAX_BUCKET_ROWS,
  type RunConsolidationOptions,
  type ConsolidationReport,
  type ConsolidationClusterReport,
  type ConsolidationDigestReport,
  type ConsolidationBucketRef,
  type ConsolidationStats,
} from './consolidation'
export {
  maybeEnqueueConsolidationForCharacters,
  maybeEnqueueConsolidationAfterCommit,
  runScheduledConsolidation,
} from './consolidation-triggers'
