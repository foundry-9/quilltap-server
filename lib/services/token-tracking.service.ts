/**
 * Token Tracking Service
 *
 * Handles incrementing token usage on connection profiles and chat aggregates.
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import type { PriceSource } from './cost-estimation.service';

const logger = createServiceLogger('token-tracking');

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/**
 * Increment token usage on a connection profile
 */
export async function incrementProfileTokenUsage(
  profileId: string,
  usage: TokenUsage
): Promise<void> {
  const promptTokens = usage.promptTokens || 0;
  const completionTokens = usage.completionTokens || 0;

  if (promptTokens === 0 && completionTokens === 0) {
    logger.debug('No tokens to increment for profile', { profileId });
    return;
  }

  try {
    const { getRepositories } = await import('@/lib/repositories/factory');
    const repos = getRepositories();

    await repos.connections.incrementTokenUsage(
      profileId,
      promptTokens,
      completionTokens
    );

    logger.debug('Incremented profile token usage', {
      profileId,
      promptTokens,
      completionTokens,
    });
  } catch (error) {
    logger.error('Failed to increment profile token usage', {
      profileId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Update chat token aggregates
 */
export async function updateChatTokenAggregates(
  chatId: string,
  usage: TokenUsage,
  estimatedCost: number | null,
  priceSource?: PriceSource
): Promise<void> {
  const promptTokens = usage.promptTokens || 0;
  const completionTokens = usage.completionTokens || 0;

  if (promptTokens === 0 && completionTokens === 0) {
    logger.debug('No tokens to aggregate for chat', { chatId });
    return;
  }

  try {
    const { getRepositories } = await import('@/lib/repositories/factory');
    const repos = getRepositories();

    await repos.chats.incrementTokenAggregates(
      chatId,
      promptTokens,
      completionTokens,
      estimatedCost,
      priceSource
    );

    logger.debug('Updated chat token aggregates', {
      chatId,
      promptTokens,
      completionTokens,
      estimatedCost,
      priceSource,
    });
  } catch (error) {
    logger.error('Failed to update chat token aggregates', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Track token usage for a message
 * Increments both profile and chat token counts
 */
export async function trackMessageTokenUsage(
  chatId: string,
  profileId: string | null | undefined,
  usage: TokenUsage,
  estimatedCost: number | null,
  priceSource?: PriceSource
): Promise<void> {
  logger.debug('Tracking message token usage', {
    chatId,
    profileId,
    usage,
    estimatedCost,
    priceSource,
  });

  // Increment profile tokens if profile ID is available
  if (profileId) {
    await incrementProfileTokenUsage(profileId, usage);
  }

  // Update chat aggregates
  await updateChatTokenAggregates(chatId, usage, estimatedCost, priceSource);
}
