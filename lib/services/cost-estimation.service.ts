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
import {
  getModelPricing as fetchModelPricing,
  getOpenRouterPricingForModel,
} from '@/lib/llm/pricing-fetcher';

const logger = createServiceLogger('cost-estimation');

export type PriceSource = 'openrouter' | 'registry' | 'fallback' | 'openrouter-estimate' | 'unavailable';

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
  /** Every token: uncached input, output, cache reads and cache writes. */
  totalTokens: number;
  /** Uncached input tokens. */
  promptTokens: number;
  completionTokens: number;
  /** Input tokens served from a provider's prompt cache. */
  cacheReadTokens?: number;
  /** Input tokens written into a provider's prompt cache. */
  cacheWriteTokens?: number;
  estimatedCostUSD: number | null;
  priceSource: PriceSource;
  messageBreakdown?: MessageCostBreakdown[];
  systemEventBreakdown?: SystemEventCostBreakdown[];
}

/** A model's pricing and where it came from. */
interface ResolvedPricing {
  pricing: ModelPricing;
  source: Exclude<PriceSource, 'unavailable'>;
}

/**
 * Find a model's pricing: OpenRouter's own for an OpenRouter model, then the
 * provider plugin's table, then the provider's fetched price list, then
 * OpenRouter's public data as an estimate. Null when nothing prices it.
 */
async function resolvePricing(
  provider: Provider,
  modelName: string,
  userId: string
): Promise<ResolvedPricing | null> {
  if (provider === 'OPENROUTER') {
    const openRouterPricing = await fetchModelPricing('OPENROUTER', modelName, userId);
    if (openRouterPricing) return { pricing: openRouterPricing, source: 'openrouter' };
  }

  const registryPricing = getModelPricingFromRegistry(provider, modelName);
  if (registryPricing) return { pricing: registryPricing, source: 'registry' };

  const fetchedPricing = await fetchModelPricing(provider, modelName, userId);
  if (fetchedPricing) return { pricing: fetchedPricing, source: 'fallback' };

  // OpenRouter public pricing as final fallback for providers without pricing
  // APIs (may differ from direct pricing).
  if (provider !== 'OPENROUTER') {
    const openRouterEstimate = await getOpenRouterPricingForModel(provider, modelName);
    if (openRouterEstimate) return { pricing: openRouterEstimate, source: 'openrouter-estimate' };
  }

  return null;
}

/**
 * Fill in cache rates the chosen pricing does not publish (a plugin's table
 * carries input and output only) from OpenRouter's public data for the same
 * model, which lists them for most cached models. Whatever is still unknown
 * is priced at the input rate by `estimateCost`.
 */
async function withCacheRates(
  resolved: ResolvedPricing,
  provider: Provider,
  modelName: string
): Promise<ModelPricing> {
  const { pricing } = resolved;
  if (pricing.cacheReadCostPer1M != null && pricing.cacheWriteCostPer1M != null) return pricing;
  if (provider === 'OPENROUTER') return pricing;
  const public_ = await getOpenRouterPricingForModel(provider, modelName);
  if (!public_) return pricing;
  return {
    ...pricing,
    cacheReadCostPer1M: pricing.cacheReadCostPer1M ?? public_.cacheReadCostPer1M ?? null,
    cacheWriteCostPer1M: pricing.cacheWriteCostPer1M ?? public_.cacheWriteCostPer1M ?? null,
  };
}

/**
 * Estimate the cost of a message given provider, model, and token counts
 * (uncached input and output only — see {@link estimateCallCost} for a call
 * with prompt-cache traffic).
 */
export async function estimateMessageCost(
  provider: Provider,
  modelName: string,
  promptTokens: number,
  completionTokens: number,
  userId: string
): Promise<CostEstimateResult> {
  return estimateCallCost(provider, modelName, { promptTokens, completionTokens }, userId);
}

/**
 * Estimate the cost of one provider call: uncached input, output, and the
 * prompt-cache reads and writes at their own rates.
 */
export async function estimateCallCost(
  provider: Provider,
  modelName: string,
  tokens: { promptTokens: number; completionTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
  userId: string
): Promise<CostEstimateResult> {
  try {
    const resolved = await resolvePricing(provider, modelName, userId);
    if (!resolved) return { cost: null, source: 'unavailable' };

    const hasCache = (tokens.cacheReadTokens ?? 0) > 0 || (tokens.cacheWriteTokens ?? 0) > 0;
    const pricing = hasCache ? await withCacheRates(resolved, provider, modelName) : resolved.pricing;
    const cost = estimateCost(pricing, tokens.promptTokens, tokens.completionTokens, {
      cacheReadTokens: tokens.cacheReadTokens,
      cacheWriteTokens: tokens.cacheWriteTokens,
    });
    return { cost, source: resolved.source, modelPricing: pricing };
  } catch (error) {
    logger.error('Failed to estimate call cost', {
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
    const cacheReadTokens = chat.totalCacheReadTokens || 0;
    const cacheWriteTokens = chat.totalCacheWriteTokens || 0;
    const totalTokens = totalPromptTokens + totalCompletionTokens + cacheReadTokens + cacheWriteTokens;
    const estimatedCostUSD = chat.estimatedCostUSD ?? null;

    // Use stored price source, or infer from whether we have a cost estimate
    let priceSource: PriceSource = 'unavailable';
    if (chat.priceSource) {
      priceSource = chat.priceSource as PriceSource;
    } else if (estimatedCostUSD !== null) {
      // Legacy chats without priceSource field - assume registry
      priceSource = 'registry';
    }
    return {
      totalTokens,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      cacheReadTokens,
      cacheWriteTokens,
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
