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
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createAuthenticatedParamsHandler, type AuthenticatedContext } from '@/lib/api/middleware';
import { withActionDispatch } from '@/lib/api/middleware/actions';
import { logger } from '@/lib/logger';
import { badRequest, notFound, successResponse, serverError } from '@/lib/api/responses';
import {
  triggerTurnMemoryExtraction,
  triggerChatDangerClassification,
  triggerContextSummaryCheck,
  type MemoryChatSettings,
} from '@/lib/services/chat-message/memory-trigger.service';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';

/**
 * Handle overriding danger flags on a message
 * Sets all dangerFlags entries to userOverridden: true
 */
async function handleOverrideDangerFlag(
  _req: NextRequest,
  { user, repos }: AuthenticatedContext,
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
  { user, repos }: AuthenticatedContext,
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
    const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings);
    const memoryChatSettings: MemoryChatSettings = {
      cheapLLMSettings: chatSettings?.cheapLLMSettings,
      dangerSettings,
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
  { user, repos }: AuthenticatedContext,
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

export const POST = createAuthenticatedParamsHandler<{ id: string; messageId: string }>(
  withActionDispatch({
    'override-danger-flag': handleOverrideDangerFlag,
    'resolve-external-turn': handleResolveExternalTurn,
    'cancel-external-turn': handleCancelExternalTurn,
  })
);
