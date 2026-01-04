/**
 * Chat Cost Endpoint
 *
 * GET /api/chats/[id]/cost
 * Returns token usage and cost breakdown for a chat
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, type AuthenticatedContext } from '@/lib/api/middleware';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getChatCostBreakdown, getDetailedChatCostBreakdown } from '@/lib/services/cost-estimation.service';

const logger = createServiceLogger('api:chat-cost');

/**
 * GET /api/chats/[id]/cost
 * Returns token usage and cost breakdown for a chat
 *
 * Query params:
 * - detailed: boolean - If true, returns per-message breakdown (more expensive)
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (
    request: NextRequest,
    { user, repos }: AuthenticatedContext,
    params: { id: string }
  ) => {
    const chatId = params.id;

    logger.debug('Getting chat cost breakdown', { chatId, userId: user.id });

    try {
      // Verify chat exists and belongs to user
      const chat = await repos.chats.findById(chatId);
      if (!chat) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
      }
      if (chat.userId !== user.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      }

      // Check if detailed breakdown is requested
      const searchParams = request.nextUrl.searchParams;
      const detailed = searchParams.get('detailed') === 'true';

      let breakdown;
      if (detailed) {
        breakdown = await getDetailedChatCostBreakdown(chatId, user.id);
      } else {
        breakdown = await getChatCostBreakdown(chatId, user.id);
      }

      logger.debug('Chat cost breakdown retrieved', {
        chatId,
        totalTokens: breakdown.totalTokens,
        estimatedCostUSD: breakdown.estimatedCostUSD,
        priceSource: breakdown.priceSource,
      });

      return NextResponse.json(breakdown);
    } catch (error) {
      logger.error('Failed to get chat cost breakdown', { chatId }, error as Error);
      return NextResponse.json(
        { error: 'Failed to get cost breakdown' },
        { status: 500 }
      );
    }
  }
);
