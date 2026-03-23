/**
 * Chats API v1 - Participant Actions
 *
 * Handles add-participant, update-participant, remove-participant,
 * impersonate, stop-impersonate, and set-active-speaker actions
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, badRequest, validationError, serverError } from '@/lib/api/responses';
import {
  impersonateSchema,
  stopImpersonateSchema,
  setActiveSpeakerSchema,
  addParticipantSchema,
  updateParticipantSchema,
  removeParticipantSchema,
} from '../schemas';
import { enrichParticipant, handleAddParticipant, handleParticipantUpdate, handleRemoveParticipant } from '../helpers';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import type { ChatMetadata } from '@/lib/schemas/types';
import { isParticipantPresent } from '@/lib/schemas/types';

/**
 * Start impersonating a participant
 */
export async function handleImpersonate(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { participantId } = impersonateSchema.parse(body);


    const participant = chat.participants.find((p) => p.id === participantId);
    if (!participant) {
      return notFound('Participant');
    }
    if (!isParticipantPresent(participant.status)) {
      return badRequest('Participant is not active or silent');
    }

    const updatedChat = await repos.chats.addImpersonation(chatId, participantId);
    if (!updatedChat) {
      return serverError('Failed to start impersonation');
    }

    let characterName = 'Unknown';
    if (participant.characterId) {
      const character = await repos.characters.findById(participant.characterId);
      if (character) {
        characterName = character.name;
      }
    }

    logger.info('[Chats v1] Impersonation started', { chatId, participantId, characterName });

    return NextResponse.json({
      success: true,
      participantId,
      characterName,
      impersonatingParticipantIds: updatedChat.impersonatingParticipantIds,
      activeTypingParticipantId: updatedChat.activeTypingParticipantId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Chats v1] Error starting impersonation', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to start impersonation');
  }
}

/**
 * Stop impersonating a participant
 */
export async function handleStopImpersonate(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { participantId, newConnectionProfileId } = stopImpersonateSchema.parse(body);


    const participant = chat.participants.find((p) => p.id === participantId);
    if (!participant) {
      return notFound('Participant');
    }

    let updatedChat = await repos.chats.removeImpersonation(chatId, participantId);
    if (!updatedChat) {
      return serverError('Failed to stop impersonation');
    }

    if (newConnectionProfileId) {
      const profile = await repos.connections.findById(newConnectionProfileId);
      if (!profile || profile.userId !== user.id) {
        return notFound('Connection profile');
      }

      updatedChat = await repos.chats.updateParticipant(chatId, participantId, {
        connectionProfileId: newConnectionProfileId,
        controlledBy: 'llm',
      });
    }

    let characterName = 'Unknown';
    if (participant.characterId) {
      const character = await repos.characters.findById(participant.characterId);
      if (character) {
        characterName = character.name;
      }
    }

    logger.info('[Chats v1] Impersonation stopped', { chatId, participantId, characterName });

    return NextResponse.json({
      success: true,
      participantId,
      characterName,
      impersonatingParticipantIds: updatedChat?.impersonatingParticipantIds || [],
      activeTypingParticipantId: updatedChat?.activeTypingParticipantId || null,
      newConnectionProfileId: newConnectionProfileId || null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Chats v1] Error stopping impersonation', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to stop impersonation');
  }
}

/**
 * Set the active typing participant
 */
export async function handleSetActiveSpeaker(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { participantId } = setActiveSpeakerSchema.parse(body);


    const participant = chat.participants.find((p) => p.id === participantId);
    if (!participant) {
      return notFound('Participant');
    }

    let impersonatingIds = chat.impersonatingParticipantIds || [];
    if (!impersonatingIds.includes(participantId)) {
      if (participant.controlledBy === 'user') {
        logger.info('[Chats v1] Auto-adding user-controlled participant to impersonation', {
          chatId,
          participantId,
        });
        impersonatingIds = [...impersonatingIds, participantId];
        await repos.chats.update(chatId, { impersonatingParticipantIds: impersonatingIds });
      } else {
        return badRequest('Participant is not being impersonated');
      }
    }

    const updatedChat = await repos.chats.setActiveTypingParticipant(chatId, participantId);
    if (!updatedChat) {
      return serverError('Failed to set active speaker');
    }

    let characterName = 'Unknown';
    if (participant.characterId) {
      const character = await repos.characters.findById(participant.characterId);
      if (character) {
        characterName = character.name;
      }
    }

    logger.info('[Chats v1] Active speaker set', { chatId, participantId, characterName });

    return NextResponse.json({
      success: true,
      activeTypingParticipantId: participantId,
      characterName,
      impersonatingParticipantIds: impersonatingIds,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Chats v1] Error setting active speaker', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to set active speaker');
  }
}

/**
 * Add a new participant to the chat
 */
export async function handleAddParticipantAction(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const validatedData = addParticipantSchema.parse(body);


    // Check if character is already in the chat
    if (validatedData.type === 'CHARACTER' && validatedData.characterId) {
      const activeParticipant = chat.participants.find(
        (p) => p.type === 'CHARACTER' && p.characterId === validatedData.characterId && isParticipantPresent(p.status)
      );
      if (activeParticipant) {
        return badRequest('Character is already in this chat');
      }

      // Check for deactivated (silenced) participant — still in chat, just inactive
      const deactivatedParticipant = chat.participants.find(
        (p) => p.type === 'CHARACTER' && p.characterId === validatedData.characterId && p.status === 'absent'
      );
      if (deactivatedParticipant) {
        return badRequest('Character is already in this chat (currently deactivated)');
      }

      // Check for soft-deleted participant — reactivate instead of creating duplicate
      const removedParticipant = chat.participants.find(
        (p) => p.type === 'CHARACTER' && p.characterId === validatedData.characterId && p.status === 'removed'
      );
      if (removedParticipant) {
        const controlledBy = validatedData.controlledBy || removedParticipant.controlledBy || 'llm';
        const updatedChat = await repos.chats.updateParticipant(chatId, removedParticipant.id, {
          status: 'active',
          isActive: true,
          removedAt: null,
          controlledBy,
          connectionProfileId: validatedData.connectionProfileId || removedParticipant.connectionProfileId,
          displayOrder: chat.participants.filter(p => isParticipantPresent(p.status)).length,
        });
        if (!updatedChat) {
          return serverError('Failed to reactivate participant');
        }

        const reactivatedParticipant = updatedChat.participants.find(p => p.id === removedParticipant.id);
        const enrichedParticipant = reactivatedParticipant ? await enrichParticipant(reactivatedParticipant, repos) : null;

        logger.info('[Chats v1] Participant reactivated', { chatId, participantId: removedParticipant.id });
        return NextResponse.json({ participant: enrichedParticipant, chat: updatedChat }, { status: 200 });
      }
    }

    const result = await handleAddParticipant(chatId, validatedData, chat.participants.length, user.id, repos);

    if ('error' in result) {
      if (result.status === 404) return notFound('Resource');
      if (result.status === 400) return badRequest(result.error);
      return serverError(result.error);
    }

    const newParticipant = result.chat.participants.find(
      (p) => p.characterId === validatedData.characterId
    );

    const enrichedParticipant = newParticipant ? await enrichParticipant(newParticipant, repos) : null;

    logger.info('[Chats v1] Participant added', { chatId, participantId: newParticipant?.id });

    return NextResponse.json({ participant: enrichedParticipant, chat: result.chat }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Chats v1] Error adding participant', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to add participant');
  }
}

/**
 * Update an existing participant
 */
export async function handleUpdateParticipantAction(
  req: NextRequest,
  chatId: string,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const validatedData = updateParticipantSchema.parse(body);


    const result = await handleParticipantUpdate(chatId, validatedData, user.id, repos);

    if ('error' in result) {
      if (result.status === 404) return notFound('Resource');
      if (result.status === 400) return badRequest(result.error);
      return serverError(result.error);
    }

    const updatedParticipant = result.chat.participants.find((p) => p.id === validatedData.participantId);
    const enrichedParticipant = updatedParticipant ? await enrichParticipant(updatedParticipant, repos) : null;

    logger.info('[Chats v1] Participant updated', { chatId, participantId: validatedData.participantId });

    return NextResponse.json({ participant: enrichedParticipant, chat: result.chat });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Chats v1] Error updating participant', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to update participant');
  }
}

/**
 * Remove a participant from the chat
 */
export async function handleRemoveParticipantAction(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const validatedData = removeParticipantSchema.parse(body);


    const participantToRemove = chat.participants.find((p) => p.id === validatedData.participantId);
    if (!participantToRemove) {
      return notFound('Participant');
    }

    const activeCharacters = chat.participants.filter((p) => p.type === 'CHARACTER' && isParticipantPresent(p.status));
    if (activeCharacters.length <= 1 && participantToRemove.type === 'CHARACTER') {
      return badRequest('Cannot remove the last character from the chat');
    }

    const result = await handleRemoveParticipant(chatId, validatedData.participantId, repos);

    if ('error' in result) {
      if (result.status === 404) return notFound('Resource');
      if (result.status === 400) return badRequest(result.error);
      return serverError(result.error);
    }

    // Clean up impersonation state for removed participant
    const currentImpersonating = result.chat.impersonatingParticipantIds || [];
    if (currentImpersonating.includes(validatedData.participantId)) {
      const cleanedIds = currentImpersonating.filter((id: string) => id !== validatedData.participantId);
      const updateData: Record<string, unknown> = { impersonatingParticipantIds: cleanedIds };
      if (result.chat.activeTypingParticipantId === validatedData.participantId) {
        updateData.activeTypingParticipantId = cleanedIds[0] || null;
      }
      await repos.chats.update(chatId, updateData);
    }

    logger.info('[Chats v1] Participant removed', { chatId, participantId: validatedData.participantId });

    return NextResponse.json({ success: true, chat: result.chat });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    if (error instanceof Error && error.message.includes('last participant')) {
      return badRequest('Cannot remove the last participant from a chat');
    }

    logger.error('[Chats v1] Error removing participant', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to remove participant');
  }
}
