/**
 * Memory System Module
 * Sprint 2+: Memory System Implementation
 *
 * This module provides memory management functionality for characters,
 * including automatic memory extraction, summarization, and context management.
 */

// Cheap LLM Tasks
export {
  extractUserMemoriesFromTurn,
  extractSelfMemoriesFromTurn,
  extractInterCharacterMemoriesFromTurn,
  summarizeChat,
  titleChat,
  updateContextSummary,
  describeAttachment,
  batchExtractMemories,
  considerTitleUpdate,
  deriveSceneContext,
  type MemoryCandidate,
  type ChatMessage,
  type Attachment,
  type CheapLLMTaskResult,
  type DeriveSceneContextInput,
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
