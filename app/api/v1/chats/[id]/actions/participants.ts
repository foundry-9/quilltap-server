/**
 * Chats API v1 - Participant Actions
 *
 * Handles add-participant, update-participant, remove-participant,
 * impersonate, stop-impersonate, and set-active-speaker actions
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, errorResponse } from '@/lib/api/responses';
import {
  impersonateSchema,
  stopImpersonateSchema,
  setActiveSpeakerSchema,
  addParticipantSchema,
  updateParticipantSchema,
  removeParticipantSchema,
} from '../schemas';
import { enrichParticipant, handleAddParticipant, handleParticipantUpdate, handleRemoveParticipant, resolveParticipantCharacterName } from '../helpers';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata } from '@/lib/schemas/types';
import { isParticipantPresent } from '@/lib/schemas/types';
import {
  postHostRemoveAnnouncement,
  postHostJoinScenarioAnnouncement,
} from '@/lib/services/host-notifications/writer';
import { compileIdentityStackForParticipant } from '@/lib/services/system-prompt-compiler/compiler';
import { seatArrival } from '@/lib/chat/opening/arrival';
import type { GreenRoomNarrator } from '@/lib/chat/opening/narrator';
import { openNarrationStream } from '@/lib/chat/opening/narrator-frames';
import { sseStreamResponse } from '@/lib/services/chat-message';

/**
 * Answer an add-participant request with the Green Room's narration of the
 * arrival, for a Salon that is watching (`narrate: true`).
 */
function narratedArrival(
  characterName: string,
  arrive: (narrator: GreenRoomNarrator) => Promise<void>,
): NextResponse {
  return sseStreamResponse(openNarrationStream(async (narrator) => {
    narrator.phase('arrivals', `${characterName} arrives…`);
    narrator.status(`${characterName} arrives…`);
    await arrive(narrator);
  }));
}

/**
 * Start impersonating a participant
 */
export async function handleImpersonate(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const { participantId } = impersonateSchema.parse(body);

  const participant = chat.participants.find((p) => p.id === participantId);
  if (!participant) {
    return notFound('Participant');
  }
  if (!isParticipantPresent(participant.status)) {
    return badRequest('Participant is not active or silent');
  }

  // Impersonation is a BEHAVIOR change, not a state change (Bug 44): the seat's
  // durable ownership (`controlledBy`) and connection profile stay exactly where
  // they were. `addImpersonation` — which records the id in
  // `impersonatingParticipantIds` and sets `activeTypingParticipantId` — is the
  // whole state change. The attribution and turn-taking resolvers honour that
  // overlay (see `isUserDrivenSeat`), so no column moves and no identity stack
  // recompiles. Not mutating `controlledBy` is what keeps the "user seat" stable
  // and the card's own Stop button reachable.
  const updatedChat = await repos.chats.addImpersonation(chatId, participantId);
  if (!updatedChat) {
    return serverError('Failed to start impersonation');
  }

  const characterName = await resolveParticipantCharacterName(participant, repos);

  logger.info('[Chats v1] Impersonation started', { chatId, participantId, characterName });

  return NextResponse.json({
    success: true,
    participantId,
    characterName,
    impersonatingParticipantIds: updatedChat.impersonatingParticipantIds,
    activeTypingParticipantId: updatedChat.activeTypingParticipantId,
  });
}

/**
 * Stop impersonating a participant
 */
export async function handleStopImpersonate(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const { participantId, newConnectionProfileId } = stopImpersonateSchema.parse(body);

  const participant = chat.participants.find((p) => p.id === participantId);
  if (!participant) {
    return notFound('Participant');
  }

  // Impersonation is an overlay (Bug 44): the seat was never disturbed on start,
  // so there is nothing to restore. `removeImpersonation` — which drops the id
  // from `impersonatingParticipantIds` and re-points `activeTypingParticipantId`
  // — is the whole state change. No `controlledBy` write, no identity-stack
  // recompile.
  let updatedChat = await repos.chats.removeImpersonation(chatId, participantId);
  if (!updatedChat) {
    return serverError('Failed to stop impersonation');
  }

  // A new connection profile may accompany the hand-back — the client's stop
  // flow offers one when the character has none, so a formerly-impersonated seat
  // isn't left LLM-controlled with no way to answer. This is a DELIBERATE seat
  // reassignment, a separate concern from stopping the impersonation: route it
  // through a plain participant update (profile only — `controlledBy` never
  // moved, so there is nothing to flip and nothing to recompile).
  if (newConnectionProfileId) {
    const profile = await repos.connections.findById(newConnectionProfileId);
    if (!profile) {
      return notFound('Connection profile');
    }

    updatedChat = await repos.chats.updateParticipant(chatId, participantId, {
      connectionProfileId: newConnectionProfileId,
    }) ?? updatedChat;
  }

  const characterName = await resolveParticipantCharacterName(participant, repos);

  logger.info('[Chats v1] Impersonation stopped', { chatId, participantId, characterName });

  return NextResponse.json({
    success: true,
    participantId,
    characterName,
    impersonatingParticipantIds: updatedChat?.impersonatingParticipantIds || [],
    activeTypingParticipantId: updatedChat?.activeTypingParticipantId || null,
    newConnectionProfileId: newConnectionProfileId || null,
  });
}

/**
 * Set the active typing participant
 */
export async function handleSetActiveSpeaker(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { repos }: RequestContext
): Promise<NextResponse> {
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

  const characterName = await resolveParticipantCharacterName(participant, repos);

  logger.info('[Chats v1] Active speaker set', { chatId, participantId, characterName });

  return NextResponse.json({
    success: true,
    activeTypingParticipantId: participantId,
    characterName,
    impersonatingParticipantIds: impersonatingIds,
  });
}

/**
 * Add a new participant to the chat
 */
export async function handleAddParticipantAction(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { user, repos }: RequestContext
): Promise<NextResponse> {
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

      let reactivatedCharacter = null;
      if (reactivatedParticipant?.characterId) {
        reactivatedCharacter = await repos.characters.findById(reactivatedParticipant.characterId);
      }
      const reactivatedCharacterName = reactivatedCharacter?.name || 'Unknown';
      logger.info('[Chats v1] Participant reactivated', {
        chatId, participantId: removedParticipant.id, characterName: reactivatedCharacterName,
        controlledBy,
      });

      // The returning seat arrives as every seat does. It keeps what it had
      // on unless the caller sent a new outfit.
      if (reactivatedCharacter && reactivatedParticipant?.characterId) {
        const characterId = reactivatedParticipant.characterId;
        const arrive = (narrator?: GreenRoomNarrator) => seatArrival(repos, chatId, {
          characterId,
          outfitSelection: validatedData.outfitSelection,
          redress: !!validatedData.outfitSelection,
        }, { source: 'participant-added', userId: user.id, narrator });
        if (validatedData.narrate) return narratedArrival(reactivatedCharacter.name, arrive);
        await arrive();
      }

      return NextResponse.json({ participant: enrichedParticipant, chat: updatedChat }, { status: 200 });
    }
  }

  const result = await handleAddParticipant(chatId, validatedData, chat.participants.length, user.id, repos);

  if ('error' in result) {
    if (result.status === 404) return errorResponse(result.error, 404);
    if (result.status === 400) return badRequest(result.error);
    return serverError(result.error);
  }

  const newParticipant = result.chat.participants.find(
    (p) => p.characterId === validatedData.characterId
  );

  const enrichedParticipant = newParticipant ? await enrichParticipant(newParticipant, repos) : null;

  const addedCharacter = validatedData.characterId
    ? await repos.characters.findById(validatedData.characterId)
    : null;
  const addedCharacterName = addedCharacter?.name || 'Unknown';
  logger.info('[Chats v1] Participant added', {
    chatId, participantId: newParticipant?.id, characterName: addedCharacterName,
    controlledBy: validatedData.controlledBy || 'llm',
  });

  if (addedCharacter && newParticipant) {
    // Dressed, packed, compiled, welcomed, announced and drawn — the one
    // arrival — then the scene the newcomer walks into, when one was given.
    const arrive = async (narrator?: GreenRoomNarrator) => {
      await seatArrival(repos, chatId, {
        characterId: addedCharacter.id,
        outfitSelection: validatedData.outfitSelection,
        redress: true,
      }, { source: 'participant-added', userId: user.id, narrator });
      if (validatedData.joinScenario && !(validatedData.hasHistoryAccess ?? false)) {
        await postHostJoinScenarioAnnouncement({
          chatId,
          characterName: addedCharacter.name,
          targetParticipantId: newParticipant.id,
          joinScenario: validatedData.joinScenario,
        });
      }
    };
    if (validatedData.narrate) return narratedArrival(addedCharacter.name, arrive);
    await arrive();
  }

  return NextResponse.json({ participant: enrichedParticipant, chat: result.chat }, { status: 201 });
}

/**
 * Force-rebuild the cached identity stack (system prompt prefix) for a single
 * participant. Used by the Participants sidebar "Rebuild system prompt"
 * button to pick up edits to the underlying character (manifesto, personality,
 * named systemPrompts, etc.) that aren't auto-invalidated by the compiler.
 */
export async function handleRebuildSystemPromptAction(
  req: NextRequest,
  chatId: string,
  { repos }: RequestContext,
): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const participantId = typeof body?.participantId === 'string' ? body.participantId : null;
  if (!participantId) {
    return badRequest('participantId is required');
  }

  const chat = await repos.chats.findById(chatId);
  if (!chat) return notFound('Chat');

  const participant = chat.participants.find((p) => p.id === participantId);
  if (!participant) return notFound('Participant');

  if (participant.type !== 'CHARACTER' || participant.controlledBy === 'user') {
    return badRequest('System prompt rebuild is only available for LLM-controlled characters');
  }

  const characterName = await resolveParticipantCharacterName(participant, repos);

  try {
    await compileIdentityStackForParticipant(chat, participantId);
  } catch (error) {
    logger.error('[Chats v1] Manual system-prompt rebuild failed', {
      chatId, participantId, characterName,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to rebuild system prompt');
  }

  logger.info('[Chats v1] System prompt rebuilt manually', { chatId, participantId, characterName });

  const refreshedChat = await repos.chats.findById(chatId);
  return NextResponse.json({ ok: true, chat: refreshedChat ?? chat });
}

/**
 * Update an existing participant
 */
export async function handleUpdateParticipantAction(
  req: NextRequest,
  chatId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  // Support both wrapped ({ updateParticipant: { ... } }) and unwrapped ({ participantId, ... }) formats
  const rawData = body.updateParticipant ?? body;
  const validatedData = updateParticipantSchema.parse(rawData);

  // Capture pre-update state for logging
  const preChat = await repos.chats.findById(chatId);
  const preParticipant = preChat?.participants.find((p) => p.id === validatedData.participantId);
  const preStatus = preParticipant?.status || (preParticipant?.isActive ? 'active' : 'absent');

  // Resolve character name for logging
  const characterName = await resolveParticipantCharacterName(preParticipant, repos);

  const { participantId, ...updateFields } = validatedData;

  const result = await handleParticipantUpdate(chatId, validatedData, user.id, repos);

  if ('error' in result) {
    logger.warn('[Chats v1] Participant update failed', {
      chatId, participantId, characterName,
      error: result.error, status: result.status,
    });
    if (result.status === 404) return errorResponse(result.error, 404);
    if (result.status === 400) return badRequest(result.error);
    return serverError(result.error);
  }

  const updatedParticipant = result.chat.participants.find((p) => p.id === validatedData.participantId);
  const enrichedParticipant = updatedParticipant ? await enrichParticipant(updatedParticipant, repos) : null;
  const postStatus = updatedParticipant?.status || 'unknown';

  logger.info('[Chats v1] Participant updated', {
    chatId, participantId: validatedData.participantId, characterName,
    statusChange: preStatus !== postStatus ? `${preStatus} → ${postStatus}` : null,
    updatedFields: Object.keys(updateFields),
  });

  return NextResponse.json({ participant: enrichedParticipant, chat: result.chat });
}

/**
 * Remove a participant from the chat
 */
export async function handleRemoveParticipantAction(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const validatedData = removeParticipantSchema.parse(body);

  const participantToRemove = chat.participants.find((p) => p.id === validatedData.participantId);
  if (!participantToRemove) {
    logger.warn('[Chats v1] Participant removal failed: not found', {
      chatId, participantId: validatedData.participantId,
    });
    return notFound('Participant');
  }

  // Resolve character name for logging
  const characterName = await resolveParticipantCharacterName(participantToRemove, repos);
  const previousStatus = participantToRemove.status || (participantToRemove.isActive ? 'active' : 'absent');

  const activeCharacters = chat.participants.filter((p) => p.type === 'CHARACTER' && isParticipantPresent(p.status));
  if (activeCharacters.length <= 1 && participantToRemove.type === 'CHARACTER') {
    logger.warn('[Chats v1] Participant removal blocked: last character', {
      chatId, participantId: validatedData.participantId, characterName,
      activeCharacterCount: activeCharacters.length,
    });
    return badRequest('Cannot remove the last character from the chat');
  }

  const result = await handleRemoveParticipant(chatId, validatedData.participantId, repos);

  if ('error' in result) {
    logger.warn('[Chats v1] Participant removal failed', {
      chatId, participantId: validatedData.participantId, characterName,
      error: result.error, status: result.status,
    });
    if (result.status === 404) return errorResponse(result.error, 404);
    if (result.status === 400) return badRequest(result.error);
    return serverError(result.error);
  }

  // Clean up impersonation state for removed participant. The cleanup update
  // happens after result.chat was captured, so the returned chat must reflect
  // it — otherwise the response still lists the removed participant in
  // impersonatingParticipantIds (stale client state until a refetch).
  let finalChat = result.chat;
  const currentImpersonating = result.chat.impersonatingParticipantIds || [];
  if (currentImpersonating.includes(validatedData.participantId)) {
    const cleanedIds = currentImpersonating.filter((id: string) => id !== validatedData.participantId);
    const updateData: Record<string, unknown> = { impersonatingParticipantIds: cleanedIds };
    if (result.chat.activeTypingParticipantId === validatedData.participantId) {
      updateData.activeTypingParticipantId = cleanedIds[0] || null;
    }
    const cleanedChat = await repos.chats.update(chatId, updateData);
    if (cleanedChat) {
      finalChat = cleanedChat;
    }
  }

  // A seat that has left can never collect what it was handed out of character,
  // and a pending row would keep its name on the composer's chip forever. Never
  // allowed to break the removal itself — the seat is already gone.
  try {
    const droppedInforms = await repos.chatInforms.deletePendingForParticipant(
      chatId,
      validatedData.participantId,
    );
    logger.debug('[Chats v1] Pending informs dropped with removed seat', {
      chatId, participantId: validatedData.participantId, droppedInforms,
    });
  } catch (error) {
    logger.warn('[Chats v1] Could not drop pending informs for removed seat', {
      chatId, participantId: validatedData.participantId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('[Chats v1] Participant removed', {
    chatId, participantId: validatedData.participantId, characterName,
    previousStatus,
  });

  if (characterName !== 'Unknown') {
    await postHostRemoveAnnouncement({
      chatId,
      characterName,
      participantId: validatedData.participantId,
    });
  }

  return NextResponse.json({ success: true, chat: finalChat });
}
