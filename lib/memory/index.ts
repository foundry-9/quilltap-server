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
  type MemoryDraft,
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

// The memory candidate: the one shape producers emit (refactor §3.2)
export {
  MemoryCandidateSchema,
  TargetingTagsSchema,
  DEFAULT_TARGETING,
  normaliseTargeting,
  targetingKeywords,
  splitTargetingKeywords,
  coerceImportance,
  candidateFromDraft,
  toCreateMemoryOptions,
  type MemoryCandidate,
  type TargetingTags,
  type CandidatePass,
} from './candidate'

// The three numbers: relevance · salience · protection (refactor §3.4)
export {
  relevance,
  salience,
  protection,
  reinforcedImportance,
  importanceBand,
  RECALL_MIN_IMPORTANCE,
  TOOL_MIN_IMPORTANCE,
} from './scoring'

// One memory clock (refactor §3.3)
export {
  clockFor,
  resolveEventTime,
  resolveReferenceWindow,
  DAY_REFERENCE_TABLE,
  type MemoryClock,
  type TimeWindow,
} from './time'

// One read of every memory knob (refactor §3.1)
export {
  resolveMemorySettings,
  MEMORY_SETTING_DEFAULTS,
  ADMISSION_THRESHOLDS,
  type MemorySettings,
} from './settings'

// The index gets an owner: every embedding and tier write (refactor §3.5)
export {
  memoryIndex,
  embeddingTextFor,
  type MemoryIndex,
  type MemoryIndexEntry,
  type MemoryIndexUpsert,
} from './index-store'

// One deletion (refactor §3.10)
export {
  retireMemories,
  retireChatMemories,
  type RetireReason,
  type RetireOptions,
  type RetireReport,
} from './retire'

// Hand edits (refactor §3.11)
export { updateMemory, type MemoryEditPatch, type UpdateMemoryResult } from './admission'
