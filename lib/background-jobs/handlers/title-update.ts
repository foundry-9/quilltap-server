/**
 * Title Update Job Handler
 *
 * Handles TITLE_UPDATE background jobs by evaluating whether a chat
 * needs a new title based on recent conversation content.
 */

import { BackgroundJob, MessageEvent } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { considerTitleUpdate, ChatMessage } from '@/lib/memory/cheap-llm-tasks';
import { getCheapLLMProvider, CheapLLMConfig } from '@/lib/llm/cheap-llm';
import { logger } from '@/lib/logger';
import type { TitleUpdatePayload } from '../queue-service';

/**
 * Handle a title update job
 */
export async function handleTitleUpdate(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as TitleUpdatePayload;

  logger.debug('[TitleUpdate] Starting job', {
    jobId: job.id,
    chatId: payload.chatId,
    currentInterchange: payload.currentInterchange,
  });

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

  logger.debug('[TitleUpdate] Using cheap LLM', {
    jobId: job.id,
    provider: cheapLLMSelection.provider,
    model: cheapLLMSelection.modelName,
  });

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
    logger.debug('[TitleUpdate] No messages in chat', {
      jobId: job.id,
      chatId: payload.chatId,
    });
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
    logger.debug('[TitleUpdate] No title update needed', {
      jobId: job.id,
      chatId: payload.chatId,
      reason: result.result?.reason || 'No update needed',
    });
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
}
