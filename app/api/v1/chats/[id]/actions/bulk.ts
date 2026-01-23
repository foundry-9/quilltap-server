/**
 * Chats API v1 - Bulk Actions
 *
 * Handles bulk-reattribute action
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, validationError, serverError } from '@/lib/api/responses';
import { deleteMemoryWithVector } from '@/lib/memory/memory-service';
import { bulkReattributeSchema } from '../schemas';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import type { ChatMetadata, MessageEvent, ChatEvent } from '@/lib/schemas/types';

/**
 * Bulk re-attribute messages from one participant to another
 */
export async function handleBulkReattribute(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const validatedData = bulkReattributeSchema.parse(body);
    const { sourceParticipantId, targetParticipantId, roleFilter } = validatedData;

    if (sourceParticipantId === targetParticipantId) {
      return badRequest('Source and target participants must be different');
    }

    logger.debug('[Chats v1] Processing bulk message re-attribution', {
      chatId,
      sourceParticipantId,
      targetParticipantId,
      roleFilter,
    });

    // Validate participants exist in this chat
    if (sourceParticipantId !== null) {
      const sourceParticipant = chat.participants.find((p) => p.id === sourceParticipantId);
      if (!sourceParticipant) {
        return badRequest('Source participant not found in chat');
      }
    }

    const targetParticipant = chat.participants.find((p) => p.id === targetParticipantId);
    if (!targetParticipant) {
      return badRequest('Target participant not found in chat');
    }

    // Get all messages
    const allMessages = await repos.chats.getMessages(chatId);

    // Find all messages matching the criteria
    const affectedMessages = allMessages.filter((msg): msg is MessageEvent => {
      if (msg.type !== 'message') return false;
      // Handle null sourceParticipantId (unassigned messages)
      if (sourceParticipantId === null) {
        if (msg.participantId !== null && msg.participantId !== undefined) return false;
      } else {
        if (msg.participantId !== sourceParticipantId) return false;
      }
      if (roleFilter === 'both') return true;
      return msg.role === roleFilter;
    });

    logger.debug('[Chats v1] Found messages to re-attribute', {
      chatId,
      affectedCount: affectedMessages.length,
      roleFilter,
    });

    if (affectedMessages.length === 0) {
      return NextResponse.json({
        success: true,
        messagesUpdated: 0,
        memoriesDeleted: 0,
      });
    }

    // Delete memories for all affected messages
    let memoriesDeleted = 0;
    const affectedMessageIds = new Set(affectedMessages.map((m) => m.id));

    for (const msg of affectedMessages) {
      const memoriesFromMessage = await repos.memories.findBySourceMessageId(msg.id);

      logger.debug('[Chats v1] Found memories for message', {
        messageId: msg.id,
        memoryCount: memoriesFromMessage.length,
      });

      for (const memory of memoriesFromMessage) {
        try {
          const deleted = await deleteMemoryWithVector(memory.characterId, memory.id);
          if (deleted) {
            memoriesDeleted++;
            logger.debug('[Chats v1] Deleted memory during bulk re-attribution', {
              memoryId: memory.id,
              characterId: memory.characterId,
              sourceMessageId: msg.id,
            });
          }
        } catch (error) {
          logger.error(
            '[Chats v1] Failed to delete memory during bulk re-attribution',
            {
              memoryId: memory.id,
              error: error instanceof Error ? error.message : String(error),
            }
          );
          // Continue with other memories - best effort cleanup
        }
      }
    }

    // Update all messages
    const updatedMessages: ChatEvent[] = allMessages.map((msg) => {
      if (msg.type === 'message' && affectedMessageIds.has(msg.id)) {
        return { ...msg, participantId: targetParticipantId };
      }
      return msg;
    });

    // Rewrite all messages
    await repos.chats.clearMessages(chatId);
    for (const msg of updatedMessages) {
      await repos.chats.addMessage(chatId, msg);
    }

    // Update chat's updatedAt timestamp
    await repos.chats.update(chatId, {});

    logger.info('[Chats v1] Bulk character replace completed', {
      chatId,
      sourceParticipantId,
      targetParticipantId,
      roleFilter,
      messagesUpdated: affectedMessages.length,
      memoriesDeleted,
    });

    return NextResponse.json({
      success: true,
      messagesUpdated: affectedMessages.length,
      memoriesDeleted,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }
    logger.error('[Chats v1] Error in bulk re-attribution', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to re-attribute messages');
  }
}
