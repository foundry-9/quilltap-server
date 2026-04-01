/**
 * System Events Service
 *
 * Handles creating system events for cheap LLM operations like memory extraction,
 * summarization, title generation, etc. These events appear in the chat timeline
 * and track token usage for background operations.
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import type { SystemEventType, SystemEvent } from '@/lib/schemas/types';

const logger = createServiceLogger('system-events');

export interface SystemEventInput {
  systemEventType: SystemEventType;
  description: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  provider?: string;
  modelName?: string;
  estimatedCostUSD?: number | null;
}

/**
 * Create a system event and add it to a chat
 */
export async function createSystemEvent(
  chatId: string,
  event: SystemEventInput
): Promise<SystemEvent | null> {
  try {
    const { getRepositories } = await import('@/lib/repositories/factory');
    const repos = getRepositories();

    const systemEvent: SystemEvent = {
      type: 'system',
      id: crypto.randomUUID(),
      systemEventType: event.systemEventType,
      description: event.description,
      promptTokens: event.promptTokens ?? null,
      completionTokens: event.completionTokens ?? null,
      totalTokens: event.totalTokens ?? null,
      provider: event.provider ?? null,
      modelName: event.modelName ?? null,
      estimatedCostUSD: event.estimatedCostUSD ?? null,
      createdAt: new Date().toISOString(),
    };

    // Add system event to chat messages
    await repos.chats.addMessage(chatId, systemEvent);
    // Also update chat token aggregates for this operation
    if (event.promptTokens || event.completionTokens) {
      const { updateChatTokenAggregates } = await import('./token-tracking.service');
      await updateChatTokenAggregates(
        chatId,
        {
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
          totalTokens: event.totalTokens,
        },
        event.estimatedCostUSD ?? null
      );
    }

    return systemEvent;
  } catch (error) {
    logger.error('Failed to create system event', {
      chatId,
      eventType: event.systemEventType,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Create a system event for memory extraction
 */
export async function createMemoryExtractionEvent(
  chatId: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null,
  provider?: string,
  modelName?: string,
  estimatedCostUSD?: number | null
): Promise<SystemEvent | null> {
  return createSystemEvent(chatId, {
    systemEventType: 'MEMORY_EXTRACTION',
    description: 'Extracted memories from conversation',
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    totalTokens: usage?.totalTokens,
    provider,
    modelName,
    estimatedCostUSD,
  });
}

/**
 * Create a system event for summarization
 */
export async function createSummarizationEvent(
  chatId: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null,
  provider?: string,
  modelName?: string,
  estimatedCostUSD?: number | null
): Promise<SystemEvent | null> {
  return createSystemEvent(chatId, {
    systemEventType: 'SUMMARIZATION',
    description: 'Summarized conversation for context window',
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    totalTokens: usage?.totalTokens,
    provider,
    modelName,
    estimatedCostUSD,
  });
}

/**
 * Create a system event for title generation
 */
export async function createTitleGenerationEvent(
  chatId: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null,
  provider?: string,
  modelName?: string,
  estimatedCostUSD?: number | null
): Promise<SystemEvent | null> {
  return createSystemEvent(chatId, {
    systemEventType: 'TITLE_GENERATION',
    description: 'Generated chat title',
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    totalTokens: usage?.totalTokens,
    provider,
    modelName,
    estimatedCostUSD,
  });
}

/**
 * Create a system event for context summary
 */
export async function createContextSummaryEvent(
  chatId: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null,
  provider?: string,
  modelName?: string,
  estimatedCostUSD?: number | null
): Promise<SystemEvent | null> {
  return createSystemEvent(chatId, {
    systemEventType: 'CONTEXT_SUMMARY',
    description: 'Generated context summary',
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    totalTokens: usage?.totalTokens,
    provider,
    modelName,
    estimatedCostUSD,
  });
}

/**
 * Create a system event for image prompt crafting
 */
export async function createImagePromptCraftingEvent(
  chatId: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null,
  provider?: string,
  modelName?: string,
  estimatedCostUSD?: number | null
): Promise<SystemEvent | null> {
  return createSystemEvent(chatId, {
    systemEventType: 'IMAGE_PROMPT_CRAFTING',
    description: 'Crafted image generation prompt',
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    totalTokens: usage?.totalTokens,
    provider,
    modelName,
    estimatedCostUSD,
  });
}
