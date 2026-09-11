/**
 * Chats API v1 - Impersonation Voice Preview Action
 *
 * Restates a line the operator typed while impersonating a character in that
 * character's own voice — the IN-SCENE cousin of `?action=announcement-preview`.
 * Nothing is persisted: the caller (the Salon's In Their Own Words dialog) shows
 * the proposal to the operator, who sends it, edits it, regenerates it, or sends
 * their own draft as written. The posted line then goes out through the ordinary
 * send path, attributed to the seat exactly as it would be without the rewrite.
 *
 * The impersonation is re-derived from the chat row — the client's claim about
 * which seat it is driving is never trusted.
 *
 * POST /api/v1/chats/[id]?action=impersonation-voice-preview
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest, notFound } from '@/lib/api/responses';
import { isParticipantPresent } from '@/lib/schemas/chat.types';
import { generateInSceneVoicedLine } from '@/lib/services/announcer/in-scene-voiced';
import { resolveSelectedSubprompts } from '@/lib/subprompts/subprompts';
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import { resolveProviderForDangerousContent } from '@/lib/services/dangerous-content/provider-routing.service';
import { impersonationVoicePreviewSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata } from '@/lib/schemas/types';

export async function handleImpersonationVoicePreview(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { user, repos }: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const validated = impersonationVoicePreviewSchema.parse(body);

  const participant = chat.participants.find((p) => p.id === validated.participantId);
  if (!participant) {
    return notFound('Participant');
  }
  if (participant.type !== 'CHARACTER' || !participant.characterId) {
    return badRequest('Only a character seat can be spoken for.');
  }
  if (!isParticipantPresent(participant.status)) {
    return badRequest('That character is not present in this chat.');
  }
  // The overlay on the chat row is the authority, not the client's claim.
  if (!(chat.impersonatingParticipantIds ?? []).includes(participant.id)) {
    return badRequest('That seat is not being impersonated.');
  }
  logger.debug('[Chats v1] Impersonation voice preview: seat verified', {
    chatId,
    participantId: participant.id,
    characterId: participant.characterId,
  });

  // A broken vault throws `CharacterVaultUnavailableError`; the middleware maps
  // it rather than this handler guessing at a substitute voice.
  const character = await repos.characters.findById(participant.characterId);
  if (!character) {
    return notFound('Character');
  }

  // Profile: operator override → the seat's own → the character's default →
  // the instance default. The seat keeps its `connectionProfileId` under the
  // impersonation overlay, which is exactly the voice we want.
  let profile = validated.connectionProfileId
    ? await repos.connections.findById(validated.connectionProfileId)
    : null;
  let profileSource = profile ? 'override' : '';
  if (!profile && participant.connectionProfileId) {
    profile = await repos.connections.findById(participant.connectionProfileId);
    if (profile) profileSource = 'participant';
  }
  if (!profile && character.defaultConnectionProfileId) {
    profile = await repos.connections.findById(character.defaultConnectionProfileId);
    if (profile) profileSource = 'character-default';
  }
  if (!profile) {
    profile = await repos.connections.findDefault(user.id);
    if (profile) profileSource = 'instance-default';
  }
  if (!profile) {
    return badRequest('No connection profile to rewrite with');
  }
  logger.debug('[Chats v1] Impersonation voice preview: profile resolved', {
    chatId,
    participantId: participant.id,
    profileId: profile.id,
    profileSource,
  });

  // A chat the Concierge has flagged already runs its turns on the uncensored
  // route; the rehearsal follows the turn rather than asking a moderated
  // provider to restate what it would refuse. A refusal here is an ordinary
  // preview failure and never escalates on its own (bug 133's principle).
  if (shouldUseUncensoredRoute(chat)) {
    const chatSettings = await repos.chatSettings.findByUserId(user.id);
    const dangerSettings = resolveDangerousContentSettings(chatSettings, chat).settings;
    if (dangerSettings.mode === 'AUTO_ROUTE' && !profile.isDangerousCompatible) {
      // The api key the helper hands back is discarded — `executeCheapLLMTask`
      // resolves its own from the profile. Only the profile choice is wanted.
      const routeResult = await resolveProviderForDangerousContent(
        profile,
        '',
        dangerSettings,
        user.id,
      );
      if (routeResult.rerouted) {
        profile = routeResult.connectionProfile;
        profileSource = 'uncensored-route';
        logger.debug('[Chats v1] Impersonation voice preview: rerouted to uncensored profile', {
          chatId,
          participantId: participant.id,
          profileId: profile.id,
        });
      }
    }
  }

  // System prompt: operator override → the seat's own → the character's
  // default → their `isDefault` prompt → their first.
  const characterPrompts = character.systemPrompts ?? [];
  const systemPromptId =
    validated.systemPromptId
    ?? participant.selectedSystemPromptId
    ?? character.defaultSystemPromptId
    ?? characterPrompts.find((p) => p.isDefault)?.id
    ?? characterPrompts[0]?.id
    ?? null;

  const subprompts = await resolveSelectedSubprompts(
    character.id,
    participant.selectedSubpromptIds ?? [],
  );
  logger.debug('[Chats v1] Impersonation voice preview: prompt resolved', {
    chatId,
    participantId: participant.id,
    systemPromptId,
    subprompts: subprompts.length,
  });

  const result = await generateInSceneVoicedLine({
    chat,
    participant,
    character,
    profile,
    seedMarkdown: validated.seedMarkdown,
    systemPromptId,
    subprompts,
    userId: user.id,
  });

  if (!result.success) {
    return badRequest(result.error || 'Failed to restate the line in character.');
  }

  logger.info('[Chats v1] Impersonation voice preview generated', {
    chatId,
    participantId: participant.id,
    characterId: character.id,
    profileId: profile.id,
    seedLength: validated.seedMarkdown.length,
    proposedLength: result.proposedMarkdown.length,
  });

  return NextResponse.json({
    success: true,
    proposedMarkdown: result.proposedMarkdown,
    profileName: profile.name,
    modelName: profile.modelName,
  });
}
