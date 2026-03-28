/**
 * Context Summary Job Handler
 *
 * Handles CONTEXT_SUMMARY background jobs by updating the running
 * context summary for a chat conversation.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { updateContextSummary, extractVisibleConversation } from '@/lib/memory/cheap-llm-tasks';
import { getCheapLLMProvider, CheapLLMConfig, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm';
import { logger } from '@/lib/logger';
import { createContextSummaryEvent } from '@/lib/services/system-events.service';
import { enqueueChatDangerClassification } from '../queue-service';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import type { ContextSummaryPayload } from '../queue-service';

/**
 * Handle a context summary update job
 */
export async function handleContextSummary(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as ContextSummaryPayload;
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
  let cheapLLMSelection = getCheapLLMProvider(
    connectionProfile,
    cheapLLMConfig,
    availableProfiles
  );

  // For dangerous chats, use uncensored provider to avoid content refusals
  const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings);
  if (chat.isDangerousChat === true) {
    cheapLLMSelection = resolveUncensoredCheapLLMSelection(
      cheapLLMSelection,
      true,
      dangerSettings,
      availableProfiles
    );
  }

  // Get all chat messages and extract only visible conversation (USER/ASSISTANT, tool artifacts stripped)
  const allMessages = await repos.chats.getMessages(payload.chatId);
  const chatMessages = extractVisibleConversation(allMessages);

  // Get current context summary from chat
  const currentSummary = chat.contextSummary || '';
  const lastSummaryMessageIndex = chat.lastRenameCheckInterchange ?? 0;

  // Get new messages since last summary (or all if forceRegenerate)
  const newMessages = payload.forceRegenerate
    ? chatMessages
    : chatMessages.slice(lastSummaryMessageIndex);

  if (newMessages.length === 0) {
    return;
  }

  // Update the context summary
  const result = await updateContextSummary(
    currentSummary,
    newMessages,
    cheapLLMSelection,
    job.userId,
    payload.chatId
  );

  if (!result.success) {
    logger.warn('[ContextSummary] Summary update failed', {
      jobId: job.id,
      chatId: payload.chatId,
      error: result.error,
    });
    return;
  }

  // Update chat with new summary
  await repos.chats.update(payload.chatId, {
    contextSummary: result.result,
    lastRenameCheckInterchange: chatMessages.length,
  });

  // Create a system event for tracking
  await createContextSummaryEvent(
    payload.chatId,
    result.usage || null
  );

  logger.info('[ContextSummary] Summary updated', {
    jobId: job.id,
    chatId: payload.chatId,
    summaryLength: result.result?.length || 0,
    messagesProcessed: newMessages.length,
  });

  // Chain: enqueue danger classification after successful summary update
  try {
    if (dangerSettings.mode !== 'OFF') {
      const chainResult = await enqueueChatDangerClassification(
        job.userId,
        {
          chatId: payload.chatId,
          connectionProfileId: payload.connectionProfileId,
        },
        { priority: -2 }
      );
    } else {
    }
  } catch (chainError) {
    logger.warn('[ContextSummary] Failed to chain danger classification job', {
      jobId: job.id,
      chatId: payload.chatId,
      error: chainError instanceof Error ? chainError.message : String(chainError),
    });
  }
}
