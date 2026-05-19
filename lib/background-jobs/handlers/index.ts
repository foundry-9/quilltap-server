/**
 * Background Job Handler Registry
 *
 * Maps job types to their handler functions.
 */

import { BackgroundJobType } from '@/lib/schemas/types';
import { handleMemoryExtraction } from './memory-extraction';
import { handleInterCharacterMemory } from './inter-character-memory';
import { handleContextSummary } from './context-summary';
import { handleTitleUpdate } from './title-update';
import { handleLLMLogCleanup } from './llm-log-cleanup';
import { handleEmbeddingGenerate } from './embedding-generate';
import { handleEmbeddingRefit } from './embedding-refit';
import { handleEmbeddingReindexAll } from './embedding-reindex';
import { handleEmbeddingReapplyProfile } from './embedding-reapply-profile';
import { handleStoryBackgroundGeneration } from './story-background';
import { handleChatDangerClassification } from './chat-danger-classification';
import { handleSceneStateTracking } from './scene-state-tracking';
import { handleCharacterAvatarGeneration } from './character-avatar';
import { handleConversationRender } from './conversation-render';
import { handleMemoryHousekeeping } from './memory-housekeeping';
import { handleMemoryRegenerateChat } from './memory-regenerate-chat';
import { handleMemoryRegenerateAll } from './memory-regenerate-all';
import { handleWardrobeOutfitAnnouncement } from './wardrobe-announcement';

/**
 * Job handler function type
 */
export type JobHandler = (job: import('@/lib/schemas/types').BackgroundJob) => Promise<void>;

/**
 * Handler registry
 */
const handlers: Record<BackgroundJobType, JobHandler> = {
  MEMORY_EXTRACTION: handleMemoryExtraction,
  INTER_CHARACTER_MEMORY: handleInterCharacterMemory,
  CONTEXT_SUMMARY: handleContextSummary,
  TITLE_UPDATE: handleTitleUpdate,
  LLM_LOG_CLEANUP: handleLLMLogCleanup,
  EMBEDDING_GENERATE: handleEmbeddingGenerate,
  EMBEDDING_REFIT: handleEmbeddingRefit,
  EMBEDDING_REINDEX_ALL: handleEmbeddingReindexAll,
  EMBEDDING_REAPPLY_PROFILE: handleEmbeddingReapplyProfile,
  STORY_BACKGROUND_GENERATION: handleStoryBackgroundGeneration,
  CHAT_DANGER_CLASSIFICATION: handleChatDangerClassification,
  SCENE_STATE_TRACKING: handleSceneStateTracking,
  CHARACTER_AVATAR_GENERATION: handleCharacterAvatarGeneration,
  CONVERSATION_RENDER: handleConversationRender,
  MEMORY_HOUSEKEEPING: handleMemoryHousekeeping,
  MEMORY_REGENERATE_CHAT: handleMemoryRegenerateChat,
  MEMORY_REGENERATE_ALL: handleMemoryRegenerateAll,
  WARDROBE_OUTFIT_ANNOUNCEMENT: handleWardrobeOutfitAnnouncement,
};

/**
 * Get the handler for a job type
 */
export function getHandler(type: BackgroundJobType): JobHandler {
  const handler = handlers[type];
  if (!handler) {
    throw new Error(`No handler registered for job type: ${type}`);
  }
  return handler;
}

// Re-export handlers
export { handleMemoryExtraction };
export { handleInterCharacterMemory };
export { handleContextSummary };
export { handleTitleUpdate };
export { handleLLMLogCleanup };
export { handleEmbeddingGenerate };
export { handleEmbeddingRefit };
export { handleEmbeddingReindexAll };
export { handleEmbeddingReapplyProfile };
export { handleStoryBackgroundGeneration };
export { handleChatDangerClassification };
export { handleSceneStateTracking };
export { handleCharacterAvatarGeneration };
export { handleConversationRender };
export { handleMemoryHousekeeping };
export { handleMemoryRegenerateChat };
export { handleMemoryRegenerateAll };
export { handleWardrobeOutfitAnnouncement };
