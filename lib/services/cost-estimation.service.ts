/**
 * Cost Estimation Service
 *
 * Handles cost estimation for LLM usage using OpenRouter pricing when available,
 * with fallback to static pricing data.
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { Provider } from '@/lib/schemas/types';
import {
  ModelPricing,
  estimateCost,
  getModelPricingFromRegistry,
} from '@/lib/llm/pricing';
import { getModelPricing as fetchModelPricing } from '@/lib/llm/pricing-fetcher';

const logger = createServiceLogger('cost-estimation');

export type PriceSource = 'openrouter' | 'registry' | 'fallback' | 'unavailable';

export interface CostEstimateResult {
  cost: number | null;
  source: PriceSource;
  modelPricing?: ModelPricing;
}

export interface MessageCostBreakdown {
  id: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number | null;
  source: PriceSource;
}

export interface SystemEventCostBreakdown {
  id: string;
  type: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number | null;
  source: PriceSource;
}

export interface ChatCostBreakdown {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUSD: number | null;
  priceSource: PriceSource;
  messageBreakdown?: MessageCostBreakdown[];
  systemEventBreakdown?: SystemEventCostBreakdown[];
}

/**
 * Estimate the cost of a message given provider, model, and token counts
 */
export async function estimateMessageCost(
  provider: Provider,
  modelName: string,
  promptTokens: number,
  completionTokens: number,
  userId: string
): Promise<CostEstimateResult> {
  logger.debug('Estimating message cost', {
    provider,
    modelName,
    promptTokens,
    completionTokens,
  });

  try {
    // First try OpenRouter pricing if the provider is OpenRouter
    if (provider === 'OPENROUTER') {
      const openRouterPricing = await fetchModelPricing('OPENROUTER', modelName, userId);
      if (openRouterPricing) {
        const cost = estimateCost(openRouterPricing, promptTokens, completionTokens);
        logger.debug('Cost estimated from OpenRouter', {
          cost,
          modelName,
          promptCostPer1M: openRouterPricing.promptCostPer1M,
          completionCostPer1M: openRouterPricing.completionCostPer1M,
        });
        return {
          cost,
          source: 'openrouter',
          modelPricing: openRouterPricing,
        };
      }
    }

    // Try the provider registry (plugin pricing)
    const registryPricing = getModelPricingFromRegistry(provider, modelName);
    if (registryPricing) {
      const cost = estimateCost(registryPricing, promptTokens, completionTokens);
      logger.debug('Cost estimated from registry/fallback', {
        cost,
        modelName,
        provider,
        promptCostPer1M: registryPricing.promptCostPer1M,
        completionCostPer1M: registryPricing.completionCostPer1M,
      });
      return {
        cost,
        source: 'registry',
        modelPricing: registryPricing,
      };
    }

    // Try fetching from pricing cache for the provider
    const fetchedPricing = await fetchModelPricing(provider, modelName, userId);
    if (fetchedPricing) {
      const cost = estimateCost(fetchedPricing, promptTokens, completionTokens);
      logger.debug('Cost estimated from pricing cache', {
        cost,
        modelName,
        provider,
      });
      return {
        cost,
        source: 'fallback',
        modelPricing: fetchedPricing,
      };
    }

    // No pricing available
    logger.debug('No pricing data available', { provider, modelName });
    return {
      cost: null,
      source: 'unavailable',
    };
  } catch (error) {
    logger.error('Failed to estimate message cost', {
      provider,
      modelName,
    }, error as Error);
    return {
      cost: null,
      source: 'unavailable',
    };
  }
}

/**
 * Get the cost breakdown for a chat, including all messages and system events
 */
export async function getChatCostBreakdown(
  chatId: string,
  userId: string
): Promise<ChatCostBreakdown> {
  logger.debug('Getting chat cost breakdown', { chatId });

  try {
    const { getRepositories } = await import('@/lib/repositories/factory');
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      logger.warn('Chat not found for cost breakdown', { chatId });
      return {
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        estimatedCostUSD: null,
        priceSource: 'unavailable',
      };
    }

    // Use stored aggregates if available
    const totalPromptTokens = chat.totalPromptTokens || 0;
    const totalCompletionTokens = chat.totalCompletionTokens || 0;
    const totalTokens = totalPromptTokens + totalCompletionTokens;
    const estimatedCostUSD = chat.estimatedCostUSD ?? null;

    // Determine price source based on whether we have a cost estimate
    let priceSource: PriceSource = 'unavailable';
    if (estimatedCostUSD !== null) {
      // If we have a cost, it came from somewhere
      // This is a simplification - in practice we'd track the source per message
      priceSource = 'registry';
    }

    logger.debug('Chat cost breakdown retrieved', {
      chatId,
      totalTokens,
      totalPromptTokens,
      totalCompletionTokens,
      estimatedCostUSD,
    });

    return {
      totalTokens,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      estimatedCostUSD,
      priceSource,
    };
  } catch (error) {
    logger.error('Failed to get chat cost breakdown', { chatId }, error as Error);
    return {
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUSD: null,
      priceSource: 'unavailable',
    };
  }
}

/**
 * Calculate detailed cost breakdown for all messages in a chat
 * This is more expensive as it iterates through all messages
 */
export async function getDetailedChatCostBreakdown(
  chatId: string,
  userId: string
): Promise<ChatCostBreakdown> {
  logger.debug('Getting detailed chat cost breakdown', { chatId });

  try {
    const { getRepositories } = await import('@/lib/repositories/factory');
    const repos = getRepositories();

    const messages = await repos.chats.getMessages(chatId);
    if (!messages || messages.length === 0) {
      return {
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        estimatedCostUSD: null,
        priceSource: 'unavailable',
      };
    }

    const messageBreakdown: MessageCostBreakdown[] = [];
    const systemEventBreakdown: SystemEventCostBreakdown[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCost = 0;
    let hasAnyCost = false;
    let primarySource: PriceSource = 'unavailable';

    for (const event of messages) {
      if (event.type === 'message') {
        const promptTokens = event.promptTokens ?? 0;
        const completionTokens = event.completionTokens ?? 0;
        const total = event.tokenCount ?? (promptTokens + completionTokens);

        totalPromptTokens += promptTokens;
        totalCompletionTokens += completionTokens;

        // For detailed breakdown, we'd need to re-estimate costs
        // For now, just record the tokens
        messageBreakdown.push({
          id: event.id,
          promptTokens,
          completionTokens,
          totalTokens: total,
          cost: null, // Would need model info to estimate
          source: 'unavailable',
        });
      } else if (event.type === 'system') {
        const promptTokens = event.promptTokens ?? 0;
        const completionTokens = event.completionTokens ?? 0;
        const total = event.totalTokens ?? (promptTokens + completionTokens);

        totalPromptTokens += promptTokens;
        totalCompletionTokens += completionTokens;

        if (event.estimatedCostUSD !== null && event.estimatedCostUSD !== undefined) {
          totalCost += event.estimatedCostUSD;
          hasAnyCost = true;
        }

        systemEventBreakdown.push({
          id: event.id,
          type: event.systemEventType,
          promptTokens,
          completionTokens,
          totalTokens: total,
          cost: event.estimatedCostUSD ?? null,
          source: event.estimatedCostUSD !== null ? 'registry' : 'unavailable',
        });
      }
    }

    if (hasAnyCost) {
      primarySource = 'registry';
    }

    logger.debug('Detailed chat cost breakdown calculated', {
      chatId,
      messageCount: messageBreakdown.length,
      systemEventCount: systemEventBreakdown.length,
      totalPromptTokens,
      totalCompletionTokens,
      totalCost: hasAnyCost ? totalCost : null,
    });

    return {
      totalTokens: totalPromptTokens + totalCompletionTokens,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      estimatedCostUSD: hasAnyCost ? totalCost : null,
      priceSource: primarySource,
      messageBreakdown,
      systemEventBreakdown,
    };
  } catch (error) {
    logger.error('Failed to get detailed chat cost breakdown', { chatId }, error as Error);
    return {
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUSD: null,
      priceSource: 'unavailable',
    };
  }
}

// Re-export formatting functions from client-safe utility
// These are also available from @/lib/utils/format-tokens for client components
export { formatCostForDisplay, formatTokenCount } from '@/lib/utils/format-tokens';
