/**
 * Cheap LLM Tasks Service
 *
 * Domain-focused barrel exports for background LLM tasks used by the memory,
 * chat, and image generation systems.
 */

// Types
export type {
  MemoryCandidate,
  ChatMessage,
  Attachment,
  CheapLLMTaskResult,
  UncensoredFallbackOptions,
  ImagePromptExpansionContext,
  DeriveSceneContextInput,
  SceneStateInput,
  StoryBackgroundPromptContext,
  CompressionResult,
  AppearanceResolutionItem,
  CharacterAppearanceInput,
  AppearanceSanitizeMode,
  SanitizedAppearance,
} from './types'

// Execution surface — the deadline machinery and the two helpers a caller
// needs to tell "the pass never happened" apart from "the pass disappointed".
export type { CheapLLMLatencyClass, CheapLLMTaskOptions } from './core-execution'
export {
  CheapLLMTaskLostError,
  isTimeoutFailure,
  throwIfLostToTimeout,
} from './core-execution'

// Memory tasks
export {
  extractSelfMemoriesFromTurn,
  extractOtherMemoriesFromTurn,
  extractOtherMemoriesFromFold,
  batchExtractMemories,
  extractMemorySearchKeywords,
  summarizeMemoryRecap,
  extractEpisodesFromFold,
  FOLD_EPISODE_CAP,
} from './memory-tasks'
export type {
  OtherSubjectInput,
  OrientingContext,
  ExtractionClock,
  FoldEpisode,
  FoldEpisodeMessage,
  FoldOtherMessage,
  MemorySearchExtraction,
} from './memory-tasks'

// Canon block loader (used by the memory orchestrator to feed extractor prompts)
export {
  renderSelfCanonBlock,
  renderOtherCanonBlock,
  loadCanonForSelf,
  loadCanonForSelfWithCommonplace,
  loadCanonForObserverAboutSubject,
  loadCommonplaceCanon,
  NO_CANON_FALLBACK,
  CANON_BLOCK_TOKEN_CAP,
  type CanonSource,
  type SelfCanon,
} from './canon'

// Consolidation (one call per memory cluster — see lib/memory/consolidation.ts)
export {
  consolidateMemoryCluster,
  validateConsolidationOutput,
  parseConsolidationResponse,
  buildConsolidationUserMessage,
  ConsolidationOutputSchema,
  ConsolidationDigestSchema,
  ConsolidationContradictionSchema,
  CONSOLIDATION_SYSTEM_PROMPT,
  CONSOLIDATION_TASK_TYPE,
} from './consolidation-tasks'
export type {
  ConsolidationOutput,
  ConsolidationDigestOutput,
  ConsolidationContradiction,
  ConsolidationValidation,
  ValidatedConsolidation,
  ConsolidationCallInput,
  ConsolidationMemberInput,
} from './consolidation-tasks'

// Chat tasks
export {
  summarizeChat,
  stripToolArtifacts,
  extractVisibleConversation,
  titleChat,
  titleHelpChat,
  considerHelpChatTitleUpdate,
  generateHelpChatTitleFromSummary,
  generateTitleFromSummary,
  considerTitleUpdate,
  updateContextSummary,
  foldChatSummary,
} from './chat-tasks'
export type { FoldSummaryInput } from './chat-tasks'

// Image and scene tasks
export {
  describeAttachment,
  craftImagePrompt,
  deriveSceneContext,
  updateSceneState,
  craftStoryBackgroundPrompt,
  resolveAppearance,
  sanitizeAppearance,
  CONCEALMENT_MARKER,
} from './image-scene-tasks'

// Compression tasks
export {
  compressConversationHistory,
  compressSystemPrompt,
  compressMemories,
} from './compression-tasks'
