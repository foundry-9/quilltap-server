/**
 * Title Update Job Handler
 *
 * Handles TITLE_UPDATE background jobs by evaluating whether a chat
 * needs a new title based on recent conversation content.
 */

import { BackgroundJob, ChatSettings } from '@/lib/schemas/types';
import type { ChatMetadata } from '@/lib/schemas/chat.types';
import { getRepositories } from '@/lib/repositories/factory';
import { considerTitleUpdate, extractVisibleConversation } from '@/lib/memory/cheap-llm-tasks';
import { getCheapLLMProvider, CheapLLMConfig } from '@/lib/llm/cheap-llm';
import { logger } from '@/lib/logger';
import type { TitleUpdatePayload } from '../queue-service';
import { enqueueStoryBackgroundGeneration } from '../queue-service';

/**
 * Handle a title update job
 */
export async function handleTitleUpdate(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as TitleUpdatePayload;
  const repos = getRepositories();

  // Get the chat metadata
  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    throw new Error(`Chat not found: ${payload.chatId}`);
  }

  // Get connection profile
  const connectionProfile = await repos.connections.findById(payload.connectionProfileId);
  if (!connectionProfile) {
    throw new Error(`Connection profile not found: ${payload.connectionProfileId}`);
  }

  // Get user's chat settings for cheap LLM config
  const chatSettings = await repos.chatSettings.findByUserId(job.userId);
  if (!chatSettings) {
    throw new Error(`Chat settings not found for user: ${job.userId}`);
  }

  // Get available profiles for cheap LLM selection
  const availableProfiles = await repos.connections.findByUserId(job.userId);

  // Convert settings to config (handle null -> undefined conversion)
  const cheapLLMConfig: CheapLLMConfig = {
    strategy: chatSettings.cheapLLMSettings.strategy,
    userDefinedProfileId: chatSettings.cheapLLMSettings.userDefinedProfileId || undefined,
    defaultCheapProfileId: chatSettings.cheapLLMSettings.defaultCheapProfileId || undefined,
    fallbackToLocal: chatSettings.cheapLLMSettings.fallbackToLocal,
  };

  // Get cheap LLM selection
  const cheapLLMSelection = getCheapLLMProvider(
    connectionProfile,
    cheapLLMConfig,
    availableProfiles
  );
  // Get chat messages
  const allMessages = await repos.chats.getMessages(payload.chatId);

  // Extract only visible conversational messages (USER/ASSISTANT, tool artifacts stripped)
  const totalCount = allMessages.length;
  const chatMessages = extractVisibleConversation(allMessages);

  // Use last 5 messages or fewer if the chat is shorter
  const recentMessages = chatMessages.slice(-5);

  if (recentMessages.length === 0) {
    return;
  }

  // Get existing summary for context
  const existingContext = chat.contextSummary || null;

  // Evaluate whether title needs updating
  const result = await considerTitleUpdate(
    chat.title,
    recentMessages,
    existingContext,
    cheapLLMSelection,
    job.userId
  );

  if (!result.success) {
    logger.warn('[TitleUpdate] Title evaluation failed', {
      jobId: job.id,
      chatId: payload.chatId,
      error: result.error,
    });
    return;
  }

  // If no update needed, we're done
  if (!result.result || !result.result.needsNewTitle || !result.result.suggestedTitle) {
    return;
  }

  // Update the chat title
  await repos.chats.update(payload.chatId, {
    title: result.result.suggestedTitle,
    lastRenameCheckInterchange: payload.currentInterchange,
  });

  logger.info('[TitleUpdate] Title updated', {
    jobId: job.id,
    chatId: payload.chatId,
    previousTitle: chat.title,
    newTitle: result.result.suggestedTitle,
    reason: result.result.reason,
  });

  // Queue story background generation if enabled
  await queueStoryBackgroundIfEnabled(
    job.userId,
    chat,
    chatSettings,
    result.result.suggestedTitle
  );
}

/**
 * Queue a story background generation job if the feature is enabled
 */
export async function queueStoryBackgroundIfEnabled(
  userId: string,
  chat: ChatMetadata,
  chatSettings: ChatSettings,
  newTitle: string
): Promise<void> {

  // Check if story backgrounds are enabled
  const storyBackgroundsSettings = chatSettings.storyBackgroundsSettings;
  if (!storyBackgroundsSettings?.enabled) {
    return;
  }

  // Determine the image profile to use
  const imageProfileId = await resolveImageProfileForChat(userId, chat, chatSettings);
  if (!imageProfileId) {
    return;
  }

  // Get character IDs from participants
  const characterIds = chat.participants
    .filter(p => p.characterId)
    .map(p => p.characterId!);

  if (characterIds.length === 0) {
    return;
  }

  // Queue the story background generation job
  try {
    const { jobId, isNew } = await enqueueStoryBackgroundGeneration(userId, {
      chatId: chat.id,
      imageProfileId,
      characterIds,
      sceneContext: newTitle,
      projectId: chat.projectId ?? null,
    });

    if (isNew) {
      logger.info('[TitleUpdate] Queued story background generation', {
        context: 'background-jobs.title-update',
        chatId: chat.id,
        jobId,
        imageProfileId,
        characterCount: characterIds.length,
      });
    }
  } catch (error) {
    logger.warn('[TitleUpdate] Failed to queue story background generation', {
      context: 'background-jobs.title-update',
      chatId: chat.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Resolve the image profile to use for story background generation
 * Priority: Chat image profile > Story backgrounds default > User default
 */
export async function resolveImageProfileForChat(
  userId: string,
  chat: ChatMetadata,
  chatSettings: ChatSettings
): Promise<string | null> {
  const repos = getRepositories();

  // First, check the chat's image profile (most specific, chat-level)
  if (chat.imageProfileId) {
    const profile = await repos.imageProfiles.findById(chat.imageProfileId);
    if (profile && profile.userId === userId && profile.apiKeyId) {
      return profile.id;
    }
  }

  // Second, check if story backgrounds settings has a default profile
  const storyBackgroundsSettings = chatSettings.storyBackgroundsSettings;
  if (storyBackgroundsSettings?.defaultImageProfileId) {
    // Verify the profile exists and is valid
    const profile = await repos.imageProfiles.findById(storyBackgroundsSettings.defaultImageProfileId);
    if (profile && profile.userId === userId && profile.apiKeyId) {
      return profile.id;
    }
  }

  // Third, try the user's default image profile
  const defaultProfile = await repos.imageProfiles.findDefault(userId);
  if (defaultProfile && defaultProfile.apiKeyId) {
    return defaultProfile.id;
  }

  return null;
}
