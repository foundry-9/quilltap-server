/**
 * Context Summary Job Handler
 *
 * Handles CONTEXT_SUMMARY background jobs by updating the running
 * context summary for a chat conversation.
 */

import { BackgroundJob, MessageEvent } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { updateContextSummary, ChatMessage } from '@/lib/memory/cheap-llm-tasks';
import { getCheapLLMProvider, CheapLLMConfig } from '@/lib/llm/cheap-llm';
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
  const cheapLLMSelection = getCheapLLMProvider(
    connectionProfile,
    cheapLLMConfig,
    availableProfiles
  );
  // Get all chat messages
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
    job.userId
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
    const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings);
    if (dangerSettings.mode !== 'OFF') {
      const chainResult = await enqueueChatDangerClassification(
        job.userId,
        {
          chatId: payload.chatId,
          connectionProfileId: payload.connectionProfileId,
        },
        { priority: -2 }
      );
      logger.debug('[ContextSummary] Chained danger classification job', {
        jobId: job.id,
        chatId: payload.chatId,
        chainedJobId: chainResult.jobId,
        isNew: chainResult.isNew,
      });
    } else {
      logger.debug('[ContextSummary] Skipping danger classification chain — mode is OFF', {
        jobId: job.id,
        chatId: payload.chatId,
      });
    }
  } catch (chainError) {
    logger.warn('[ContextSummary] Failed to chain danger classification job', {
      jobId: job.id,
      chatId: payload.chatId,
      error: chainError instanceof Error ? chainError.message : String(chainError),
    });
  }
}
