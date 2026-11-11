/**
 * Chats API v1 - Bulk Actions
 *
 * Handles bulk-reattribute action
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest } from '@/lib/api/responses';
import { retireMemories } from '@/lib/memory/retire';
import { bulkReattributeSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata, MessageEvent } from '@/lib/schemas/types';

/**
 * Bulk re-attribute messages from one participant to another
 */
export async function handleBulkReattribute(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const validatedData = bulkReattributeSchema.parse(body);
  const { sourceParticipantId, targetParticipantId, roleFilter } = validatedData;

  if (sourceParticipantId === targetParticipantId) {
    return badRequest('Source and target participants must be different');
  }

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

  if (affectedMessages.length === 0) {
    return NextResponse.json({
      success: true,
      messagesUpdated: 0,
      memoriesDeleted: 0,
    });
  }

  // Delete memories for all affected messages
  let memoriesDeleted = 0;

  // The re-attributed lines' memories were extracted for the old speaker;
  // they go together, through the deletion chokepoint.
  const memoryIdsToRetire: string[] = [];
  for (const msg of affectedMessages) {
    const memoriesFromMessage = await repos.memories.findBySourceMessageId(msg.id);
    memoryIdsToRetire.push(...memoriesFromMessage.map((memory) => memory.id));
  }
  if (memoryIdsToRetire.length > 0) {
    try {
      const report = await retireMemories(memoryIdsToRetire, { reason: 'message-reattribution' });
      memoriesDeleted = report.retired;
    } catch (error) {
      logger.error(
        '[Chats v1] Failed to delete memories during bulk re-attribution',
        {
          memoryCount: memoryIdsToRetire.length,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      // Best effort cleanup: the re-attribution itself still proceeds
    }
  }

  // Update only the re-attributed rows' participantId, one row at a time —
  // never a clear-and-replay of the whole transcript (#164), which ran
  // addMessage's per-message bookkeeping over the history and lost every row
  // after a failed insert. A row that fails to update is logged and left as
  // it was; every other row stays in place.
  let messagesUpdated = 0;
  for (const msg of affectedMessages) {
    const updated = await repos.chats.updateMessage(chatId, msg.id, {
      participantId: targetParticipantId,
    });
    if (updated) {
      messagesUpdated++;
    } else {
      logger.warn('[Chats v1] Bulk re-attribute could not update a message', {
        chatId,
        messageId: msg.id,
      });
    }
  }

  // Update chat's updatedAt timestamp
  await repos.chats.update(chatId, {});

  logger.info('[Chats v1] Bulk character replace completed', {
    chatId,
    sourceParticipantId,
    targetParticipantId,
    roleFilter,
    messagesUpdated,
    memoriesDeleted,
  });

  return NextResponse.json({
    success: true,
    messagesUpdated,
    memoriesDeleted,
  });
}
