/**
 * Memory System Module
 * Sprint 2+: Memory System Implementation
 *
 * This module provides memory management functionality for characters,
 * including automatic memory extraction, summarization, and context management.
 */

// Cheap LLM Tasks
export {
  summarizeChat,
  titleChat,
  updateContextSummary,
  describeAttachment,
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

// Extraction: one context, four passes, cursors (memory refactor §3.7)
export {
  buildExtractionContext,
  runPass,
  runTurnExtraction,
  runCarinaExtraction,
  runFoldPass,
  runFoldCatchup,
  runExtractionDryRun,
  selfTurnPass,
  otherTurnPass,
  otherFoldPass,
  episodeFoldPass,
  type ExtractionContext,
  type ExtractionPass,
  type ExtractionPassName,
  type PassResult,
  type TurnExtractionResult,
  type FoldResult,
  type ExtractedCandidate,
} from './extraction'
export type { TurnTranscript, TurnCharacterSlice } from '@/lib/services/chat-message/turn-transcript'

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

// Recall: a pipeline with a trace (refactor §3.8)
//   query → gather → hydrate → score → select → assemble → render → deliver
export {
  buildRecallQuery,
  searchRecall,
  searchMemories,
  assembleRecall,
  deliverRecall,
  stampAccessed,
  generateMemoryRecap,
  type RecallQuery,
  type RecallCandidate,
  type RecallTrace,
  type RecallPlan,
  type RecallBundle,
  type RecallDelivery,
  type PreRecall,
  type MemoryRecapResult,
} from './recall'

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
  toAdmissionRow,
  type ResolvedCandidateTime,
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
  ADMISSION_THRESHOLDS_TFIDF,
  admissionThresholdsForProvider,
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

// Admission: decide, then apply, in the parent; one combine (refactor §3.6)
export {
  admitCandidate,
  admissionInserted,
  admissionReinforced,
  decideAdmission,
  foldInto,
  applyFold,
  extractNovelDetails,
  describeAdmission,
  updateMemory,
  type AdmitOptions,
  type AdmissionAction,
  type AdmissionOutcome,
  type AdmissionRow,
  type AdmissionTrace,
  type FoldPlan,
  type MemoryEditPatch,
  type UpdateMemoryResult,
} from './admission'
export { calculateReinforcedImportance } from './scoring'
