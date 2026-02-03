/**
 * Title Update Job Handler
 *
 * Handles TITLE_UPDATE background jobs by evaluating whether a chat
 * needs a new title based on recent conversation content.
 */

import { BackgroundJob, MessageEvent, ChatSettings } from '@/lib/schemas/types';
import type { ChatMetadata } from '@/lib/schemas/chat.types';
import { getRepositories } from '@/lib/repositories/factory';
import { considerTitleUpdate, ChatMessage } from '@/lib/memory/cheap-llm-tasks';
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

  // Filter to only messages (not system events)
  const messageEvents = allMessages.filter(
    (m): m is MessageEvent => m.type === 'message'
  );

  // Convert to ChatMessage format for the LLM task
  const chatMessages: ChatMessage[] = messageEvents.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));

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
async function queueStoryBackgroundIfEnabled(
  userId: string,
  chat: ChatMetadata,
  chatSettings: ChatSettings,
  newTitle: string
): Promise<void> {

  // Check if story backgrounds are enabled
  const storyBackgroundsSettings = chatSettings.storyBackgroundsSettings;
  if (!storyBackgroundsSettings?.enabled) {
    logger.debug('[TitleUpdate] Story backgrounds not enabled, skipping', {
      context: 'background-jobs.title-update',
      chatId: chat.id,
    });
    return;
  }

  // Determine the image profile to use
  const imageProfileId = await resolveImageProfileForChat(userId, chat, chatSettings);
  if (!imageProfileId) {
    logger.debug('[TitleUpdate] No image profile available for story background', {
      context: 'background-jobs.title-update',
      chatId: chat.id,
    });
    return;
  }

  // Get character IDs from participants
  const characterIds = chat.participants
    .filter(p => p.characterId)
    .map(p => p.characterId!);

  if (characterIds.length === 0) {
    logger.debug('[TitleUpdate] No characters in chat, skipping story background', {
      context: 'background-jobs.title-update',
      chatId: chat.id,
    });
    return;
  }

  // Queue the story background generation job
  try {
    await enqueueStoryBackgroundGeneration(userId, {
      chatId: chat.id,
      imageProfileId,
      characterIds,
      sceneContext: newTitle,
      projectId: chat.projectId ?? null,
    });

    logger.info('[TitleUpdate] Queued story background generation', {
      context: 'background-jobs.title-update',
      chatId: chat.id,
      imageProfileId,
      characterCount: characterIds.length,
    });
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
 * Priority: Story backgrounds default > Chat image profile > User default
 */
async function resolveImageProfileForChat(
  userId: string,
  chat: ChatMetadata,
  chatSettings: ChatSettings
): Promise<string | null> {
  const repos = getRepositories();

  // First, check if story backgrounds settings has a default profile
  const storyBackgroundsSettings = chatSettings.storyBackgroundsSettings;
  if (storyBackgroundsSettings?.defaultImageProfileId) {
    // Verify the profile exists and is valid
    const profile = await repos.imageProfiles.findById(storyBackgroundsSettings.defaultImageProfileId);
    if (profile && profile.userId === userId && profile.apiKeyId) {
      return profile.id;
    }
  }

  // Second, check the chat's image profile (chat-level, not per-participant)
  if (chat.imageProfileId) {
    const profile = await repos.imageProfiles.findById(chat.imageProfileId);
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
