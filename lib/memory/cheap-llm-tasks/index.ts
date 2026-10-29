/**
 * Cheap LLM Tasks Service
 *
 * Domain-focused barrel exports for background LLM tasks used by the memory,
 * chat, and image generation systems.
 */

// Types
export type {
  MemoryDraft,
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

// Recall's cheap-LLM tasks, re-exported here for their callers (the
// extraction prompts live in `lib/memory/extraction/`).
export { extractMemorySearchKeywords, type MemorySearchExtraction } from '../recall/query'
export { summarizeMemoryRecap } from '../recall/recap-summary'

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
  toVisibleConversationMessage,
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
