/**
 * Chat Token Tracking Operations
 *
 * Handles token usage aggregate tracking: incrementing and resetting
 * prompt/completion token counters and estimated cost.
 */

import { ChatMetadata } from '@/lib/schemas/types';
import { QueryFilter } from '../interfaces';
import { logger } from '@/lib/logger';
import { ChatOpsContext } from './chats-ops-context';

export class ChatTokenTrackingOps {
  constructor(private readonly ctx: ChatOpsContext) {}

  /**
   * Increment token aggregate counters for a chat
   * Uses atomic $inc operations for thread safety
   */
  async incrementTokenAggregates(
    chatId: string,
    promptTokens: number,
    completionTokens: number,
    estimatedCost: number | null,
    priceSource?: string
  ): Promise<void> {
    try {
      const collection = await this.ctx.getCollection();
      const now = this.ctx.getCurrentTimestamp();

      // Build update operations
      const updateOps: Record<string, unknown> = {
        $inc: {
          totalPromptTokens: promptTokens,
          totalCompletionTokens: completionTokens,
        },
        $set: { updatedAt: now },
      };

      // If we have a cost to add, we need special handling
      if (estimatedCost !== null && estimatedCost > 0) {
        // Update estimatedCostUSD if it exists, or set it if it doesn't
        const existing = await this.ctx.findById(chatId);
        if (existing) {
          const currentCost = existing.estimatedCostUSD || 0;
          (updateOps.$set as Record<string, unknown>).estimatedCostUSD = currentCost + estimatedCost;

          // Add priceSource if provided
          if (priceSource) {
            (updateOps.$set as Record<string, unknown>).priceSource = priceSource;
          }
        }
      }

      const result = await collection.updateOne(
        { id: chatId } as QueryFilter,
        updateOps as any
      );

      if (result.matchedCount === 0) {
        logger.warn('Chat not found for token aggregates increment', { chatId });
        return;
      }
    } catch (error) {
      logger.error('Error incrementing token aggregates', {
        chatId,
        promptTokens,
        completionTokens,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - token tracking failures shouldn't break message flow
    }
  }

  /**
   * Reset token aggregate counters for a chat
   */
  async resetTokenAggregates(chatId: string): Promise<ChatMetadata | null> {
    try {
      return await this.ctx.update(chatId, {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        estimatedCostUSD: null,
      });
    } catch (error) {
      logger.error('Error resetting token aggregates', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
