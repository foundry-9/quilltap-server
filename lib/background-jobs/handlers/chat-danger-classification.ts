/**
 * Chat Danger Classification Job Handler
 *
 * Handles CHAT_DANGER_CLASSIFICATION background jobs by classifying
 * the chat's content for dangerous content using the gatekeeper service.
 *
 * Key behaviors:
 * - Prefers compressed chat contextSummary as input
 * - Falls back to concatenated raw messages (truncated to 4000 chars) when no summary exists
 * - Once classified as dangerous, stays dangerous (sticky) — never re-checks
 * - Once classified as safe, stays safe (sticky) unless new messages are added
 * - Bails if mode is OFF or no content available (no summary AND no messages)
 */

import { BackgroundJob, MessageEvent } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { getCheapLLMProvider, CheapLLMConfig } from '@/lib/llm/cheap-llm';
import { classifyContent } from '@/lib/services/dangerous-content/gatekeeper.service';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import { createSystemEvent } from '@/lib/services/system-events.service';
import { createServiceLogger } from '@/lib/logging/create-logger';
import type { ChatDangerClassificationPayload } from '../queue-service';

const logger = createServiceLogger('ChatDangerClassificationHandler');

/**
 * Handle a chat danger classification job
 */
export async function handleChatDangerClassification(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as ChatDangerClassificationPayload;
  const repos = getRepositories();

  // Get the chat metadata
  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    logger.warn('[ChatDangerClassification] Chat not found, skipping', {
      jobId: job.id,
      chatId: payload.chatId,
    });
    return;
  }

  // Sticky: if already classified as dangerous, never re-check
  if (chat.isDangerousChat === true) {
    logger.debug('[ChatDangerClassification] Chat already classified as dangerous (sticky), skipping', {
      jobId: job.id,
      chatId: payload.chatId,
    });
    return;
  }

  // Sticky: if already classified as safe and no new messages, skip re-check
  if (chat.isDangerousChat === false &&
      chat.dangerClassifiedAtMessageCount != null &&
      (chat.messageCount ?? 0) <= chat.dangerClassifiedAtMessageCount) {
    logger.debug('[ChatDangerClassification] Chat already classified as safe at current message count (sticky), skipping', {
      jobId: job.id,
      chatId: payload.chatId,
      classifiedAtMessageCount: chat.dangerClassifiedAtMessageCount,
      currentMessageCount: chat.messageCount,
    });
    return;
  }

  // Determine classification input: prefer context summary, fall back to raw messages
  let classificationInput: string;
  let inputSource: 'summary' | 'messages';

  if (chat.contextSummary) {
    classificationInput = chat.contextSummary;
    inputSource = 'summary';
    logger.debug('[ChatDangerClassification] Using context summary for classification', {
      jobId: job.id,
      chatId: payload.chatId,
      summaryLength: chat.contextSummary.length,
    });
  } else {
    // No context summary — fall back to concatenated raw messages
    const allMessages = await repos.chats.getMessages(payload.chatId);
    const messageEvents = allMessages.filter(
      (m): m is MessageEvent => m.type === 'message'
    );

    if (messageEvents.length === 0) {
      logger.debug('[ChatDangerClassification] No context summary and no messages, skipping', {
        jobId: job.id,
        chatId: payload.chatId,
      });
      return;
    }

    // Concatenate messages as "ROLE: content" format, truncated to 4000 chars
    const MAX_INPUT_LENGTH = 4000;
    let concatenated = '';
    for (const msg of messageEvents) {
      const line = `${(msg.role || 'unknown').toUpperCase()}: ${msg.content}\n`;
      if (concatenated.length + line.length > MAX_INPUT_LENGTH) {
        concatenated += line.substring(0, MAX_INPUT_LENGTH - concatenated.length);
        break;
      }
      concatenated += line;
    }

    classificationInput = concatenated;
    inputSource = 'messages';
    logger.debug('[ChatDangerClassification] Using concatenated raw messages for classification', {
      jobId: job.id,
      chatId: payload.chatId,
      messageCount: messageEvents.length,
      inputLength: classificationInput.length,
    });
  }

  // Get user's chat settings for danger mode check
  const chatSettings = await repos.chatSettings.findByUserId(job.userId);

  // Resolve danger settings — bail if mode is OFF
  const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings);
  if (dangerSettings.mode === 'OFF') {
    logger.debug('[ChatDangerClassification] Dangerous content mode is OFF, skipping', {
      jobId: job.id,
      chatId: payload.chatId,
    });
    return;
  }

  // Get available profiles for cheap LLM selection
  const availableProfiles = await repos.connections.findByUserId(job.userId);

  // Get connection profile, falling back to first available if the original was deleted
  let connectionProfile = await repos.connections.findById(payload.connectionProfileId);
  if (!connectionProfile) {
    logger.warn('[ChatDangerClassification] Connection profile not found, trying fallback', {
      jobId: job.id,
      chatId: payload.chatId,
      connectionProfileId: payload.connectionProfileId,
    });

    if (availableProfiles.length > 0) {
      connectionProfile = availableProfiles[0];
      logger.debug('[ChatDangerClassification] Using fallback connection profile', {
        jobId: job.id,
        chatId: payload.chatId,
        fallbackProfileId: connectionProfile.id,
      });
    } else {
      logger.warn('[ChatDangerClassification] No available connection profiles, skipping', {
        jobId: job.id,
        chatId: payload.chatId,
      });
      return;
    }
  }

  // Convert settings to config
  const cheapLLMConfig: CheapLLMConfig = {
    strategy: chatSettings?.cheapLLMSettings?.strategy || 'PROVIDER_CHEAPEST',
    userDefinedProfileId: chatSettings?.cheapLLMSettings?.userDefinedProfileId || undefined,
    defaultCheapProfileId: chatSettings?.cheapLLMSettings?.defaultCheapProfileId || undefined,
    fallbackToLocal: chatSettings?.cheapLLMSettings?.fallbackToLocal ?? true,
  };

  // Get cheap LLM selection
  const cheapLLMSelection = getCheapLLMProvider(
    connectionProfile,
    cheapLLMConfig,
    availableProfiles
  );

  // Classify the chat content
  const result = await classifyContent(
    classificationInput,
    cheapLLMSelection,
    job.userId,
    dangerSettings,
    payload.chatId
  );

  // Create a system event for tracking FIRST, since addMessage increments messageCount.
  // We need to store dangerClassifiedAtMessageCount AFTER the system event so the
  // count includes the classification event itself — otherwise the +1 from the system
  // event triggers an infinite re-classification loop on every startup scan.
  if (result.usage) {
    await createSystemEvent(payload.chatId, {
      systemEventType: 'DANGER_CLASSIFICATION',
      description: `Chat-level danger classification: ${result.isDangerous ? 'dangerous' : 'safe'} (score: ${result.score.toFixed(2)})`,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      provider: cheapLLMSelection.provider,
      modelName: cheapLLMSelection.modelName,
    });
  }

  // Re-read chat to get the updated messageCount (after system event was added)
  const updatedChat = await repos.chats.findById(payload.chatId);
  const finalMessageCount = updatedChat?.messageCount ?? chat.messageCount ?? 0;

  // Update chat with classification results
  const now = new Date().toISOString();
  await repos.chats.update(payload.chatId, {
    isDangerousChat: result.isDangerous,
    dangerScore: result.score,
    dangerCategories: result.categories.map(c => c.category),
    dangerClassifiedAt: now,
    dangerClassifiedAtMessageCount: finalMessageCount,
  });

  logger.info('[ChatDangerClassification] Chat classified', {
    jobId: job.id,
    chatId: payload.chatId,
    isDangerous: result.isDangerous,
    score: result.score,
    categories: result.categories.map(c => c.category),
    messageCount: chat.messageCount,
    inputSource,
  });
}
