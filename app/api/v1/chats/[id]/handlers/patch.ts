/**
 * Chats API v1 - PATCH Handler
 *
 * PATCH /api/v1/chats/[id]?action=turn - Persist turn state
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getActionParam } from '@/lib/api/middleware/actions';
import { logger } from '@/lib/logger';
import { notFound, badRequest, validationError, serverError } from '@/lib/api/responses';
import { persistTurnSchema } from '../schemas';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * PATCH handler for persisting turn state
 */
export async function handlePatch(
  req: NextRequest,
  ctx: AuthenticatedContext,
  chatId: string
): Promise<NextResponse> {
  const { user, repos } = ctx;
  const action = getActionParam(req);

  // Only support turn action for PATCH
  if (action !== 'turn') {
    return badRequest('PATCH only supports action=turn for persisting turn state');
  }

  try {
    // Verify ownership
    const chat = await repos.chats.findById(chatId);
    if (!chat || chat.userId !== user.id) {
      return notFound('Chat');
    }

    // Parse and validate request body
    const body = await req.json();
    const { lastTurnParticipantId } = persistTurnSchema.parse(body);

    // If a participant ID is provided, verify it exists and is active
    if (lastTurnParticipantId !== null) {
      const participant = chat.participants.find(p => p.id === lastTurnParticipantId);
      if (!participant) {
        return notFound('Participant');
      }
      if (!participant.isActive) {
        // If the participant is no longer active, continue without logging
      }
    }

    // Update the chat metadata with the turn state
    await repos.chats.update(chatId, {
      lastTurnParticipantId,
    });

    return NextResponse.json({
      success: true,
      lastTurnParticipantId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Chats v1] Error persisting turn state', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to persist turn state');
  }
}
