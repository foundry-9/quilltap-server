/**
 * Chats API v1 - Turn Actions
 *
 * Handles turn action (nudge/queue/dequeue)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, badRequest, validationError, serverError } from '@/lib/api/responses';
import {
  selectNextSpeaker,
  calculateTurnStateFromHistory,
  nudgeParticipant,
  addToQueue,
  removeFromQueue,
  getQueuePosition,
  getActiveCharacterParticipants,
  findUserParticipant,
  getSelectionExplanation,
} from '@/lib/chat/turn-manager';
import { turnActionSchema } from '../schemas';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import type { ChatMetadata, MessageEvent, Character } from '@/lib/schemas/types';

/**
 * Process a turn action (nudge, queue, or dequeue)
 */
export async function handleTurnAction(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { action: turnAction, participantId } = turnActionSchema.parse(body);


    const participant = chat.participants.find((p) => p.id === participantId);
    if (!participant) {
      return notFound('Participant');
    }
    if (!participant.isActive) {
      return badRequest('Participant is not active');
    }

    const userParticipant = findUserParticipant(chat.participants);
    const userParticipantId = userParticipant?.id ?? null;

    const messages = await repos.chats.getMessages(chatId);
    const messageEvents = messages.filter(
      (m): m is typeof m & { type: 'message' } => m.type === 'message'
    ) as unknown as MessageEvent[];

    let turnState = calculateTurnStateFromHistory({
      messages: messageEvents,
      participants: chat.participants,
      userParticipantId,
    });

    switch (turnAction) {
      case 'nudge':
        turnState = nudgeParticipant(turnState, participantId);
        break;
      case 'queue':
        turnState = addToQueue(turnState, participantId);
        break;
      case 'dequeue':
        turnState = removeFromQueue(turnState, participantId);
        break;
    }

    const activeCharacterParticipants = getActiveCharacterParticipants(chat.participants);
    const charactersMap = new Map<string, Character>();
    for (const p of activeCharacterParticipants) {
      if (p.characterId) {
        const char = await repos.characters.findById(p.characterId);
        if (char) {
          charactersMap.set(p.characterId, char);
        }
      }
    }

    const nextSpeakerResult = selectNextSpeaker(chat.participants, charactersMap, turnState, userParticipantId);

    // Persist turn queue and last turn participant to database
    await repos.chats.update(chatId, {
      turnQueue: JSON.stringify(turnState.queue),
      lastTurnParticipantId: nextSpeakerResult.nextSpeakerId ?? null,
    });
    logger.debug('[Chats v1] Persisted turn state', {
      chatId,
      action: turnAction,
      queue: turnState.queue,
      nextSpeakerId: nextSpeakerResult.nextSpeakerId,
    });

    const affectedCharacter = participant.characterId ? charactersMap.get(participant.characterId) : null;return NextResponse.json({
      success: true,
      action: turnAction,
      participant: {
        id: participantId,
        name: affectedCharacter?.name ?? 'Unknown',
        queuePosition: getQueuePosition(turnState, participantId),
      },
      turn: {
        nextSpeakerId: nextSpeakerResult.nextSpeakerId,
        reason: nextSpeakerResult.reason,
        explanation: getSelectionExplanation(nextSpeakerResult),
        cycleComplete: nextSpeakerResult.cycleComplete,
        isUsersTurn: nextSpeakerResult.nextSpeakerId === null,
      },
      state: {
        queue: turnState.queue,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Chats v1] Error processing turn action', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to process turn action');
  }
}
