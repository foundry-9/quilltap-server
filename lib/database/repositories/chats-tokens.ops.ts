/**
 * Chat Token Tracking Operations
 *
 * The chat's usage aggregates: prompt / completion / cache-read / cache-write
 * token totals and the estimated cost. Written only by `accountLLMCall`
 * (`lib/services/usage-accounting.service.ts`), one call at a time, with
 * atomic `$inc`s — never read-then-set, which in the job child (reads see the
 * real row, writes are buffered) let every call but the last in a job vanish
 * from the cost. The columns are patch-only on the chats table
 * (`CHAT_USAGE_AGGREGATE_FIELDS`), so a whole-row update cannot rewind them.
 *
 * Tokens and cost are two writes on purpose: the tokens land the moment the
 * call is accounted, the cost after its pricing lookup, so a slow or failed
 * price fetch can never cost the token count.
 */

import { ChatMetadata } from '@/lib/schemas/types';
import { QueryFilter, UpdateOperators } from '../interfaces';
import { logger } from '@/lib/logger';
import { ChatOpsContext } from './chats-ops-context';
import { safeQuery } from './safe-query';
import type { UsageTally } from '@/lib/llm/profile-usage';

/** The chat columns the usage accounting owns. */
export const CHAT_USAGE_AGGREGATE_FIELDS: readonly string[] = [
  'totalPromptTokens',
  'totalCompletionTokens',
  'totalCacheReadTokens',
  'totalCacheWriteTokens',
  'estimatedCostUSD',
  'priceSource',
];

export class ChatTokenTrackingOps {
  constructor(private readonly ctx: ChatOpsContext) {}

  /** Add one call's tokens to a chat's totals. */
  async addCallUsage(chatId: string, tally: UsageTally): Promise<void> {
    const inc: Record<string, number> = {};
    if (tally.promptTokens > 0) inc.totalPromptTokens = tally.promptTokens;
    if (tally.completionTokens > 0) inc.totalCompletionTokens = tally.completionTokens;
    if (tally.cacheReadTokens > 0) inc.totalCacheReadTokens = tally.cacheReadTokens;
    if (tally.cacheWriteTokens > 0) inc.totalCacheWriteTokens = tally.cacheWriteTokens;
    if (Object.keys(inc).length === 0) return;

    await safeQuery(async () => {
      const collection = await this.ctx.getCollection();
      const result = await collection.updateOne(
        { id: chatId } as QueryFilter,
        { $inc: inc } as UpdateOperators<ChatMetadata>
      );
      if (result.matchedCount === 0) {
        logger.warn('Chat not found for usage increment', { chatId });
        return;
      }
      logger.debug('Added call usage to chat totals', { chatId, ...inc });
    }, 'Error adding call usage to chat', { chatId, ...tally }, undefined);
  }

  /**
   * Add one call's estimated cost to a chat. The price source of the latest
   * priced call is kept, as before.
   */
  async addEstimatedCost(
    chatId: string,
    cost: number,
    priceSource?: ChatMetadata['priceSource']
  ): Promise<void> {
    if (!(cost > 0)) return;
    await safeQuery(async () => {
      const collection = await this.ctx.getCollection();
      const result = await collection.updateOne(
        { id: chatId } as QueryFilter,
        {
          $inc: { estimatedCostUSD: cost },
          ...(priceSource ? { $set: { priceSource } } : {}),
        } as UpdateOperators<ChatMetadata>
      );
      if (result.matchedCount === 0) {
        logger.warn('Chat not found for cost increment', { chatId });
        return;
      }
      logger.debug('Added call cost to chat', { chatId, cost, priceSource });
    }, 'Error adding call cost to chat', { chatId, cost }, undefined);
  }

  /**
   * Reset token aggregate counters for a chat
   */
  async resetTokenAggregates(chatId: string): Promise<ChatMetadata | null> {
    return safeQuery(() => this.ctx.update(chatId, {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      estimatedCostUSD: null,
    }), 'Error resetting token aggregates', { chatId });
  }
}
