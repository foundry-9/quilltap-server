/**
 * Messages API v1 - Individual Message Endpoint
 *
 * GET /api/v1/messages/[id] - Get a specific message
 * PUT /api/v1/messages/[id] - Edit a message
 * DELETE /api/v1/messages/[id] - Delete a message (with optional memory cascade)
 * POST /api/v1/messages/[id]?action=swipe - Generate alternative response
 * POST /api/v1/messages/[id]?action=reattribute - Re-attribute to different participant
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, getActionParam } from '@/lib/api/middleware';
import { badRequest, notFound, serverError, validationError } from '@/lib/api/responses';
import { createLLMProvider } from '@/lib/llm';
import { decryptApiKey } from '@/lib/encryption';
import { deleteMemoriesBySourceMessagesWithVectors, deleteMemoriesBySourceMessageWithVectors, deleteMemoryWithVector } from '@/lib/memory/memory-service';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import type { ChatEvent, MessageEvent, ChatMetadata, ChatParticipant } from '@/lib/schemas/types';
import type { MemoryCascadeAction } from '@/lib/schemas/settings.types';

// Validation schemas
const editMessageSchema = z.object({
  content: z.string().min(1, 'Content is required'),
});

const swipeActionSchema = z.object({
  swipeIndex: z.int().min(0).optional(), // For switching swipes
});

const reattributeActionSchema = z.object({
  newParticipantId: z.uuid('New participant ID is required'),
});

// =============================================================================
// Helper: Find message across user's chats
// =============================================================================

interface MessageSearchResult {
  chat: ChatMetadata;
  message: MessageEvent;
  allMessages: ChatEvent[];
  messageIndex: number;
}

async function findMessageInUserChats(
  repos: any,
  userId: string,
  messageId: string
): Promise<MessageSearchResult | null> {
  const userChats = await repos.chats.findByUserId(userId);

  for (const chat of userChats) {
    const messages = await repos.chats.getMessages(chat.id);
    const idx = messages.findIndex(
      (m: ChatEvent): m is MessageEvent => m.type === 'message' && m.id === messageId
    );
    if (idx !== -1) {
      return {
        chat,
        message: messages[idx] as MessageEvent,
        allMessages: messages,
        messageIndex: idx,
      };
    }
  }

  return null;
}

// =============================================================================
// GET /api/v1/messages/[id] - Get a specific message
// =============================================================================

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: messageId }) => {
    try {
      logger.debug('[Messages API v1] GET message', {
        messageId,
        userId: user.id,
      });

      const result = await findMessageInUserChats(repos, user.id, messageId);
      if (!result) {
        return notFound('Message');
      }

      return NextResponse.json({ message: result.message });
    } catch (error) {
      logger.error('[Messages API v1] Error fetching message', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch message');
    }
  }
);

// =============================================================================
// PUT /api/v1/messages/[id] - Edit a message
// =============================================================================

export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: messageId }) => {
    try {
      const body = await req.json();
      const { content } = editMessageSchema.parse(body);

      logger.debug('[Messages API v1] PUT message', {
        messageId,
        userId: user.id,
      });

      const result = await findMessageInUserChats(repos, user.id, messageId);
      if (!result) {
        return notFound('Message');
      }

      // Update the message content
      const updatedMessage: MessageEvent = {
        ...result.message,
        content,
      };

      // Update the message in the array
      result.allMessages[result.messageIndex] = updatedMessage;

      // Rewrite all messages
      await repos.chats.clearMessages(result.chat.id);
      for (const msg of result.allMessages) {
        await repos.chats.addMessage(result.chat.id, msg);
      }

      // Update chat's updatedAt timestamp
      await repos.chats.update(result.chat.id, {});

      logger.debug('[Messages API v1] Message updated', {
        messageId,
        chatId: result.chat.id,
      });

      return NextResponse.json({ message: updatedMessage });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationError(error);
      }
      logger.error('[Messages API v1] Error updating message', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to update message');
    }
  }
);

// =============================================================================
// DELETE /api/v1/messages/[id] - Delete a message
// =============================================================================

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: messageId }) => {
    try {
      // Parse query params for memory handling
      const url = new URL(req.url);
      const memoryAction = url.searchParams.get('memoryAction') as MemoryCascadeAction | null;
      const skipConfirmation = url.searchParams.get('skipConfirmation') === 'true';

      logger.debug('[Messages API v1] DELETE message', {
        messageId,
        userId: user.id,
        memoryAction,
        skipConfirmation,
      });

      const result = await findMessageInUserChats(repos, user.id, messageId);
      if (!result) {
        return notFound('Message');
      }

      // Collect all message IDs to be deleted (for memory cascade)
      let messageIdsToDelete: string[] = [];
      if (result.message.swipeGroupId) {
        // Get all messages in swipe group
        messageIdsToDelete = result.allMessages
          .filter(
            (m): m is MessageEvent =>
              m.type === 'message' && m.swipeGroupId === result.message.swipeGroupId
          )
          .map((m) => m.id);
      } else {
        messageIdsToDelete = [messageId];
      }

      // Check for associated memories
      const memoryCount = await repos.memories.countBySourceMessageIds(messageIdsToDelete);

      // If memories exist and no action specified, return info for confirmation dialog
      if (memoryCount > 0 && !memoryAction && !skipConfirmation) {
        logger.debug('[Messages API v1] Message has associated memories, returning for confirmation', {
          messageId,
          memoryCount,
          isSwipeGroup: !!result.message.swipeGroupId,
        });

        return NextResponse.json({
          requiresConfirmation: true,
          memoryCount,
          messageIds: messageIdsToDelete,
          isSwipeGroup: !!result.message.swipeGroupId,
        });
      }

      // Handle memory cascade based on action
      let memoriesDeleted = 0;
      if (memoryCount > 0 && memoryAction && memoryAction !== 'KEEP_MEMORIES') {
        if (memoryAction === 'DELETE_MEMORIES' || memoryAction === 'REGENERATE_MEMORIES') {
          const { deleted, vectorsRemoved } = await deleteMemoriesBySourceMessagesWithVectors(messageIdsToDelete);
          memoriesDeleted = deleted;
          logger.info('[Messages API v1] Cascade deleted memories with message', {
            messageId,
            memoriesDeleted: deleted,
            vectorsRemoved,
          });
        }
      }

      // Filter out the deleted message(s)
      let filteredMessages: ChatEvent[];
      if (result.message.swipeGroupId) {
        filteredMessages = result.allMessages.filter(
          (m) =>
            m.type !== 'message' ||
            (m as MessageEvent).swipeGroupId !== result.message.swipeGroupId
        );
      } else {
        filteredMessages = result.allMessages.filter(
          (m) => m.type !== 'message' || m.id !== messageId
        );
      }

      // Rewrite all messages without the deleted one(s)
      await repos.chats.clearMessages(result.chat.id);
      for (const msg of filteredMessages) {
        await repos.chats.addMessage(result.chat.id, msg);
      }

      // Update chat's updatedAt timestamp
      await repos.chats.update(result.chat.id, {});

      logger.info('[Messages API v1] Message deleted', {
        messageId,
        chatId: result.chat.id,
        memoriesDeleted,
      });

      return NextResponse.json({
        success: true,
        memoriesDeleted,
      });
    } catch (error) {
      logger.error('[Messages API v1] Error deleting message', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to delete message');
    }
  }
);

// =============================================================================
// POST /api/v1/messages/[id]?action= - Actions
// =============================================================================

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: messageId }) => {
    const action = getActionParam(req);

    if (action === 'swipe') {
      return handleSwipeAction(req, { user, repos }, messageId);
    }

    if (action === 'reattribute') {
      return handleReattributeAction(req, { user, repos }, messageId);
    }

    return badRequest('Action parameter required: swipe or reattribute');
  }
);

// =============================================================================
// Action Handlers
// =============================================================================

async function handleSwipeAction(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
  messageId: string
): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = swipeActionSchema.safeParse(body);

    // If swipeIndex is provided, this is a switch operation (like PUT)
    if (parsed.success && parsed.data.swipeIndex !== undefined) {
      return handleSwitchSwipe(repos, user.id, messageId, parsed.data.swipeIndex);
    }

    // Otherwise, generate a new swipe
    return handleGenerateSwipe(repos, user.id, messageId);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Messages API v1] Error in swipe action', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to process swipe');
  }
}

async function handleGenerateSwipe(
  repos: any,
  userId: string,
  messageId: string
): Promise<NextResponse> {
  const result = await findMessageInUserChats(repos, userId, messageId);
  if (!result) {
    return notFound('Message');
  }

  // Only assistant messages can be swiped
  if (result.message.role !== 'ASSISTANT') {
    return badRequest('Only assistant messages can be swiped');
  }

  // Get connection profile from first active character participant
  const characterParticipant = result.chat.participants.find(
    (p: ChatParticipant) => p.type === 'CHARACTER' && p.isActive && p.connectionProfileId
  );
  if (!characterParticipant?.connectionProfileId) {
    return notFound('Connection profile');
  }

  const profile = await repos.connections.findById(characterParticipant.connectionProfileId);
  if (!profile) {
    return notFound('Connection profile');
  }

  // Create swipe group ID if this is the first swipe
  const swipeGroupId = result.message.swipeGroupId || `swipe-${result.message.id}`;

  // Update original message with swipe group ID if needed
  if (!result.message.swipeGroupId) {
    const msg = result.allMessages[result.messageIndex] as MessageEvent;
    msg.swipeGroupId = swipeGroupId;
    msg.swipeIndex = 0;
  }

  // Get the highest swipe index in this group
  const existingSwipes = result.allMessages.filter(
    (m): m is MessageEvent =>
      m.type === 'message' && m.swipeGroupId === swipeGroupId
  );
  const maxSwipeIndex = existingSwipes.reduce(
    (max, m) => Math.max(max, m.swipeIndex || 0),
    0
  );
  const newSwipeIndex = maxSwipeIndex + 1;

  // Get all messages before this one for context
  const messageCreatedAt = new Date(result.message.createdAt).getTime();
  const previousMessages = result.allMessages.filter(
    (m): m is MessageEvent =>
      m.type === 'message' && new Date(m.createdAt).getTime() < messageCreatedAt
  );

  // Build messages array for LLM
  const llmMessages = previousMessages.map((m) => ({
    role: m.role.toLowerCase() as 'system' | 'user' | 'assistant',
    content: m.content,
  }));

  // Get LLM provider and generate new response
  const provider = await createLLMProvider(profile.provider, profile.baseUrl || undefined);

  let apiKey = '';
  if (profile.apiKeyId) {
    const apiKeyRecord = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId);
    if (apiKeyRecord) {
      apiKey = decryptApiKey(
        apiKeyRecord.ciphertext,
        apiKeyRecord.iv,
        apiKeyRecord.authTag,
        userId
      );
    }
  }

  const params = profile.parameters as Record<string, unknown>;

  const response = await provider.sendMessage(
    {
      messages: llmMessages,
      model: profile.modelName,
      temperature: params.temperature as number | undefined,
      maxTokens: params.max_tokens as number | undefined,
      topP: params.top_p as number | undefined,
    },
    apiKey
  );

  // Handle memory cleanup for the message being swiped
  const chatSettings = await repos.chatSettings.findByUserId(userId);
  const cascadeAction = chatSettings?.memoryCascadePreferences?.onSwipeRegenerate || 'DELETE_MEMORIES';

  if (cascadeAction !== 'KEEP_MEMORIES') {
    const memoryCount = await repos.memories.countBySourceMessageId(messageId);
    if (memoryCount > 0) {
      const { deleted, vectorsRemoved } = await deleteMemoriesBySourceMessageWithVectors(messageId);
      logger.debug('[Messages API v1] Deleted memories for swipe regeneration', {
        originalMessageId: messageId,
        deleted,
        vectorsRemoved,
        cascadeAction,
      });
    }
  }

  // Create new swipe message
  const newSwipe: MessageEvent = {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'ASSISTANT',
    content: response.content,
    swipeGroupId,
    swipeIndex: newSwipeIndex,
    tokenCount: response.usage.totalTokens,
    rawResponse: response.raw,
    attachments: [],
    createdAt: result.message.createdAt, // Keep same timestamp as original
  };

  // Add new swipe to the chat messages
  await repos.chats.addMessage(result.chat.id, newSwipe);

  // Update chat's updatedAt timestamp
  await repos.chats.update(result.chat.id, {});

  logger.info('[Messages API v1] Swipe generated', {
    messageId,
    chatId: result.chat.id,
    newSwipeIndex,
  });

  return NextResponse.json({ message: newSwipe }, { status: 201 });
}

async function handleSwitchSwipe(
  repos: any,
  userId: string,
  messageId: string,
  swipeIndex: number
): Promise<NextResponse> {
  const result = await findMessageInUserChats(repos, userId, messageId);
  if (!result) {
    return notFound('Message');
  }

  if (!result.message.swipeGroupId) {
    return badRequest('Message is not part of a swipe group');
  }

  // Find the target swipe
  const targetSwipe = result.allMessages.find(
    (m): m is MessageEvent =>
      m.type === 'message' &&
      m.swipeGroupId === result.message.swipeGroupId &&
      m.swipeIndex === swipeIndex
  );

  if (!targetSwipe) {
    return notFound('Swipe');
  }

  return NextResponse.json({ message: targetSwipe });
}

async function handleReattributeAction(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
  messageId: string
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { newParticipantId } = reattributeActionSchema.parse(body);

    logger.debug('[Messages API v1] Processing message re-attribution', {
      messageId,
      newParticipantId,
    });

    const result = await findMessageInUserChats(repos, user.id, messageId);
    if (!result) {
      return notFound('Message');
    }

    // Validate the target participant exists in the chat
    const targetParticipant = result.chat.participants.find(
      (p: ChatParticipant) => p.id === newParticipantId
    );

    if (!targetParticipant) {
      logger.warn('[Messages API v1] Target participant not found in chat', {
        messageId,
        chatId: result.chat.id,
        newParticipantId,
      });
      return badRequest('Target participant not found in chat');
    }

    // Find and delete memories associated with this message
    const memoriesFromMessage = await repos.memories.findBySourceMessageId(messageId);
    let memoriesDeleted = 0;

    logger.debug('[Messages API v1] Found memories to delete for re-attribution', {
      messageId,
      memoryCount: memoriesFromMessage.length,
    });

    for (const memory of memoriesFromMessage) {
      try {
        const deleted = await deleteMemoryWithVector(memory.characterId, memory.id);
        if (deleted) {
          memoriesDeleted++;
        }
      } catch (error) {
        logger.error('[Messages API v1] Failed to delete memory during re-attribution', {
          memoryId: memory.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Update the message's participantId
    const updatedMessage: MessageEvent = {
      ...result.message,
      participantId: newParticipantId,
    };

    // Update the message in the array
    result.allMessages[result.messageIndex] = updatedMessage;

    // Rewrite all messages
    await repos.chats.clearMessages(result.chat.id);
    for (const msg of result.allMessages) {
      await repos.chats.addMessage(result.chat.id, msg);
    }

    // Update chat's updatedAt timestamp
    await repos.chats.update(result.chat.id, {});

    logger.info('[Messages API v1] Message re-attributed successfully', {
      messageId,
      chatId: result.chat.id,
      oldParticipantId: result.message.participantId,
      newParticipantId,
      memoriesDeleted,
    });

    return NextResponse.json({
      success: true,
      message: updatedMessage,
      memoriesDeleted,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Messages API v1] Error re-attributing message', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to re-attribute message');
  }
}
