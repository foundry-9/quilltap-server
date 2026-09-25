/**
 * Chat Message API v1 - Individual Message Endpoint
 *
 * POST /api/v1/chats/[id]/messages/[messageId]?action=override-danger-flag
 *   - Override danger flags on a message
 * POST /api/v1/chats/[id]/messages/[messageId]?action=resolve-external-turn
 *   - Resolve a Courier (manual / clipboard) placeholder turn by attaching
 *     the pasted reply
 * POST /api/v1/chats/[id]/messages/[messageId]?action=cancel-external-turn
 *   - Cancel a Courier placeholder turn: delete the message and unpause
 * POST /api/v1/chats/[id]/messages/[messageId]?action=save-image
 *   - Save an attached image to a chosen photo album
 * POST /api/v1/chats/[id]/messages/[messageId]?action=retry-uncensored
 *   - Regenerate an assistant message on the Concierge's uncensored desk, as a
 *     new swipe (add &stream=1 for the regeneration's SSE narration). 409
 *     `locked` / `no-understudy` when it cannot be done.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware';
import { withActionDispatch } from '@/lib/api/middleware/actions';
import { logger } from '@/lib/logger';
import { badRequest, conflict, created, notFound, successResponse, serverError } from '@/lib/api/responses';
import { regenerateMessageAsSwipe, streamSwipeRegeneration } from '@/lib/services/chat-message';
import {
  composeRetryRouteTrail,
  resolveTextRetryUnderstudy,
} from '@/lib/services/dangerous-content/retry-uncensored';
import type { MessageEvent } from '@/lib/schemas/types';
import {
  triggerTurnMemoryExtraction,
  triggerChatDangerClassification,
  triggerContextSummaryCheck,
  type MemoryChatSettings,
} from '@/lib/services/chat-message/memory-trigger.service';
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service';
import {
  saveImageToAlbum,
  SaveImageToAlbumError,
  SaveImageRequestSchema,
} from '@/lib/photos/save-image-to-album';
import { resolveSaveAttribution } from '@/lib/photos/save-attribution';

/**
 * Handle overriding danger flags on a message
 * Sets all dangerFlags entries to userOverridden: true
 */
async function handleOverrideDangerFlag(
  _req: NextRequest,
  { user, repos }: RequestContext,
  { id, messageId }: { id: string; messageId: string }
) {
  try {
    // Verify chat exists
    const chat = await repos.chats.findById(id);
    if (!chat) {
      return notFound('Chat');
    }

    // Find the message
    const messages = await repos.chats.getMessages(id);
    const message = messages.find((m: { id: string }) => m.id === messageId);
    if (!message) {
      return notFound('Message');
    }

    // Only message events can have danger flags
    if (message.type !== 'message') {
      return notFound('Message');
    }

    // Override all danger flags
    const existingFlags = message.dangerFlags || [];
    const dangerFlags = existingFlags.map((flag) => ({
      ...flag,
      userOverridden: true,
    }));

    await repos.chats.updateMessage(id, messageId, { dangerFlags });

    logger.info('[DangerousContent] Danger flags overridden by user', {
      chatId: id,
      messageId,
      userId: user.id,
      flagCount: dangerFlags.length,
    });

    return successResponse({ overridden: true, flagCount: dangerFlags.length });
  } catch (error) {
    logger.error('[DangerousContent] Failed to override danger flags', {
      chatId: id,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to override danger flags');
  }
}

const resolveExternalTurnSchema = z.object({
  replyContent: z.string().min(1, 'Reply content is required'),
});

/**
 * Resolve a Courier (manual / clipboard) placeholder turn.
 * Clears the pending fields, attaches the pasted reply as the message
 * content, unpauses the chat, and fires the same memory/danger triggers
 * a normal turn would.
 */
async function handleResolveExternalTurn(
  req: NextRequest,
  { user, repos }: RequestContext,
  { id, messageId }: { id: string; messageId: string }
) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = resolveExternalTurnSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    }

    const chat = await repos.chats.findById(id);
    if (!chat) {
      return notFound('Chat');
    }

    const messages = await repos.chats.getMessages(id);
    const message = messages.find((m: { id: string }) => m.id === messageId);
    if (!message || message.type !== 'message') {
      return notFound('Message');
    }
    if (!message.pendingExternalPrompt) {
      return badRequest('Message is not awaiting an external reply');
    }
    if (message.role !== 'ASSISTANT') {
      return badRequest('Only assistant placeholder messages can be resolved');
    }

    const replyContent = parsed.data.replyContent;
    const nowIso = new Date().toISOString();

    await repos.chats.updateMessage(id, messageId, {
      content: replyContent,
      pendingExternalPrompt: null,
      pendingExternalPromptFull: null,
      pendingExternalAttachments: null,
    });

    // The Courier — advance the per-character delta-mode checkpoint so the
    // NEXT Courier turn for this character renders only what's new since now.
    const participantForCheckpoint = message.participantId
      ? chat.participants.find((p) => p.id === message.participantId)
      : undefined;
    const characterIdForCheckpoint = participantForCheckpoint?.characterId ?? null;
    const existingCheckpoints =
      (chat.courierCheckpoints as Record<string, { lastResolvedMessageId: string; resolvedAt: string }> | null | undefined) ?? {};
    const chatUpdate: Record<string, unknown> = {
      isPaused: false,
      lastMessageAt: nowIso,
      updatedAt: nowIso,
    };
    if (characterIdForCheckpoint) {
      chatUpdate.courierCheckpoints = {
        ...existingCheckpoints,
        [characterIdForCheckpoint]: {
          lastResolvedMessageId: messageId,
          resolvedAt: nowIso,
        },
      };
    }
    await repos.chats.update(id, chatUpdate);

    // Resolve connection profile to thread through the per-turn triggers.
    // If the original Courier profile has been deleted in the meantime, fall
    // through to user defaults — these triggers only use it to record where
    // the turn was authored.
    let connectionProfile = null;
    if (message.participantId) {
      const participant = chat.participants.find((p) => p.id === message.participantId);
      if (participant?.characterId) {
        const character = await repos.characters.findById(participant.characterId);
        const profileId = participant.connectionProfileId || character?.defaultConnectionProfileId;
        if (profileId) {
          connectionProfile = await repos.connections.findById(profileId);
        }
      }
    }

    const chatSettings = await repos.chatSettings.findByUserId(user.id);
    const conciergePolicy = resolveConciergeSettings(chatSettings, chat);
    const memoryChatSettings: MemoryChatSettings = {
      cheapLLMSettings: chatSettings?.cheapLLMSettings,
      conciergePolicy,
      isDangerousChat: chat.isDangerousChat === true,
    };

    // Fire-and-forget post-response triggers. Memory extraction is gated to
    // the user's turn inside the helper, so multi-character courier chains
    // remain consistent with the streaming finalizer's behavior.
    if (connectionProfile) {
      void triggerTurnMemoryExtraction(repos, {
        chatId: id,
        userId: user.id,
        connectionProfile,
        chatSettings: memoryChatSettings,
      });
      void triggerChatDangerClassification(repos, {
        chatId: id,
        userId: user.id,
        connectionProfile,
        chatSettings: memoryChatSettings,
      });
      void triggerContextSummaryCheck(repos, {
        chatId: id,
        provider: connectionProfile.provider,
        modelName: connectionProfile.modelName,
        userId: user.id,
        connectionProfile,
        chatSettings: memoryChatSettings,
      });
    }

    logger.info('[Courier] External turn resolved', {
      chatId: id,
      messageId,
      userId: user.id,
      replyLength: replyContent.length,
      hasConnectionProfile: !!connectionProfile,
    });

    return successResponse({
      resolved: true,
      messageId,
      participantId: message.participantId ?? null,
    });
  } catch (error) {
    logger.error('[Courier] Failed to resolve external turn', {
      chatId: id,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to resolve external turn');
  }
}

/**
 * Cancel a Courier placeholder turn. Deletes the placeholder message and
 * unpauses the chat. Does not chain a next turn — the user explicitly chose
 * to abort this one.
 */
async function handleCancelExternalTurn(
  _req: NextRequest,
  { user, repos }: RequestContext,
  { id, messageId }: { id: string; messageId: string }
) {
  try {
    const chat = await repos.chats.findById(id);
    if (!chat) {
      return notFound('Chat');
    }

    const messages = await repos.chats.getMessages(id);
    const message = messages.find((m: { id: string }) => m.id === messageId);
    if (!message || message.type !== 'message') {
      return notFound('Message');
    }
    if (!message.pendingExternalPrompt) {
      return badRequest('Message is not awaiting an external reply');
    }

    await repos.chats.deleteMessagesByIds(id, [messageId]);
    await repos.chats.update(id, { isPaused: false, updatedAt: new Date().toISOString() });

    logger.info('[Courier] External turn cancelled', {
      chatId: id,
      messageId,
      userId: user.id,
    });

    return successResponse({ cancelled: true, messageId });
  } catch (error) {
    logger.error('[Courier] Failed to cancel external turn', {
      chatId: id,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to cancel external turn');
  }
}

/**
 * Save an image attachment from a chat message into a chosen photo album.
 * Mirrors the LLM `keep_image` tool but lets the human operator pick any
 * mount point (their persona's vault, any participant's vault, the project
 * album, a linked document store, or Quilltap General).
 */
async function handleSaveImage(
  req: NextRequest,
  { user, repos }: RequestContext,
  { id, messageId }: { id: string; messageId: string }
) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = SaveImageRequestSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const { fileId, mountPointId, caption, tags } = parsed.data;

    const chat = await repos.chats.findById(id);
    if (!chat) {
      return notFound('Chat');
    }

    const messages = await repos.chats.getMessages(id);
    const message = messages.find((m: { id: string }) => m.id === messageId);
    if (!message || message.type !== 'message') {
      return notFound('Message');
    }

    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    if (!attachments.includes(fileId)) {
      return badRequest('Image is not attached to this message');
    }

    // Who the save is attributed to — the one rule, shared with the
    // gallery's chat-scoped twin so both doors write the same byline into the
    // kept-image sidecar.
    const attribution = await resolveSaveAttribution(chat, mountPointId, user, repos);

    const saved = await saveImageToAlbum({
      mountPointId,
      fileId,
      caption: caption ?? null,
      tags: tags ?? [],
      chatId: id,
      attribution,
    });

    logger.info('[SaveImage] saved', {
      chatId: id,
      messageId,
      fileId,
      mountPointId,
      relativePath: saved.relativePath,
      linkId: saved.linkId,
    });

    return successResponse({
      saved: true,
      mountPoint: saved.mountPointName,
      relativePath: saved.relativePath,
      linkId: saved.linkId,
      keptAt: saved.keptAt,
      fileId: saved.fileId,
      sha256: saved.sha256,
    });
  } catch (error) {
    if (error instanceof SaveImageToAlbumError) {
      logger.info('[SaveImage] rejected', {
        chatId: id,
        messageId,
        code: error.code,
        message: error.message,
      });
      return badRequest(error.message);
    }
    logger.error('[SaveImage] failed', {
      chatId: id,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to save image');
  }
}

/**
 * "Try uncensored" on a text turn.
 *
 * A regenerate of the target assistant message — the same swipe the refresh
 * icon makes, with the same inform semantics (re-applied, never consumed) —
 * except that the Concierge's uncensored understudy takes it instead of the
 * responder's own profile. The chat's Concierge state is not touched.
 */
async function handleRetryUncensored(
  req: NextRequest,
  { user, repos }: RequestContext,
  { id, messageId }: { id: string; messageId: string }
) {
  const chat = await repos.chats.findById(id);
  if (!chat) {
    return notFound('Chat');
  }

  const allMessages = (await repos.chats.getMessages(id)).filter(
    (m): m is MessageEvent => m.type === 'message'
  );
  const targetMessage = allMessages.find((m) => m.id === messageId);
  if (!targetMessage) {
    return notFound('Message');
  }
  if (targetMessage.role !== 'ASSISTANT') {
    return badRequest('Only assistant messages can be retried');
  }
  if (targetMessage.systemSender) {
    return badRequest('Staff and system messages cannot be regenerated');
  }

  const chatSettings = await repos.chatSettings.findByUserId(user.id);
  const gate = await resolveTextRetryUnderstudy({
    repos,
    userId: user.id,
    chat,
    chatSettings,
    targetMessage,
  });
  if (!gate.ok) {
    logger.info('[DangerousContent] Uncensored retry refused', {
      chatId: id,
      messageId,
      reason: gate.reason,
    });
    return conflict(gate.reason);
  }

  const { understudy } = gate;
  const options = {
    repos,
    userId: user.id,
    chat,
    targetMessage,
    allMessages,
    activeUserParticipantId: chat.activeTypingParticipantId ?? null,
    profileOverride: understudy,
    routeTrail: composeRetryRouteTrail(targetMessage.routeTrail, understudy.profile, 'connection'),
  };

  logger.info('[DangerousContent] Retrying a turn on the uncensored desk', {
    chatId: id,
    messageId,
    understudyProfileId: understudy.profile.id,
    understudyName: understudy.profile.name,
  });

  if (req.nextUrl?.searchParams.get('stream') === '1') {
    return streamSwipeRegeneration(options, '[DangerousContent] Uncensored retry:');
  }

  try {
    const newSwipe = await regenerateMessageAsSwipe(options);
    return created({ message: newSwipe });
  } catch (error) {
    logger.error('[DangerousContent] Uncensored retry failed', {
      chatId: id,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : undefined);
    return serverError(error instanceof Error ? error.message : 'Failed to retry uncensored');
  }
}

export const POST = createContextParamsHandler<{ id: string; messageId: string }>(
  withActionDispatch({
    'override-danger-flag': handleOverrideDangerFlag,
    'resolve-external-turn': handleResolveExternalTurn,
    'cancel-external-turn': handleCancelExternalTurn,
    'save-image': handleSaveImage,
    'retry-uncensored': handleRetryUncensored,
  })
);
