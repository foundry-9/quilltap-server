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
} from './types'

// Memory tasks
export {
  extractMemoryFromMessage,
  extractCharacterMemoryFromMessage,
  extractInterCharacterMemoryFromMessage,
  batchExtractMemories,
  extractMemorySearchKeywords,
  summarizeMemoryRecap,
} from './memory-tasks'

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
} from './chat-tasks'

// Image and scene tasks
export {
  describeAttachment,
  craftImagePrompt,
  deriveSceneContext,
  updateSceneState,
  craftStoryBackgroundPrompt,
  resolveAppearance,
  sanitizeAppearance,
} from './image-scene-tasks'

// Compression tasks
export {
  compressConversationHistory,
  compressSystemPrompt,
  compressMemories,
} from './compression-tasks'
