/**
 * Chats API v1 - GET Handler
 *
 * GET /api/v1/chats/[id] - Get a specific chat
 * GET /api/v1/chats/[id]?action=export - Export chat (SillyTavern JSONL)
 * GET /api/v1/chats/[id]?action=cost - Get cost breakdown
 * GET /api/v1/chats/[id]?action=get-avatars - Get avatar overrides for chat
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { getActionParam } from '@/lib/api/middleware/actions';
import { exportSTChatAsJSONL } from '@/lib/sillytavern/chat';
import { getChatCostBreakdown, getDetailedChatCostBreakdown } from '@/lib/services/cost-estimation.service';
import { enrichParticipantDetail } from '@/lib/services/chat-enrichment.service';
import { logger } from '@/lib/logger';
import { notFound, forbidden, serverError } from '@/lib/api/responses';
import { handleGetAvatars } from '../actions';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * GET handler for individual chat
 */
export async function handleGet(
  req: NextRequest,
  ctx: AuthenticatedContext,
  chatId: string
): Promise<NextResponse> {
  const { user, repos } = ctx;
  const action = getActionParam(req);

  // Handle export action
  if (action === 'export') {
    try {
      const chat = await repos.chats.findById(chatId);
      if (!chat || chat.userId !== user.id) {
        return notFound('Chat');
      }

      const allEvents = await repos.chats.getMessages(chatId);
      const messages = allEvents.filter((event) => event.type === 'message');

      const characterParticipant = chat.participants.find((p) => p.type === 'CHARACTER' && p.characterId);
      if (!characterParticipant?.characterId) {
        return notFound('No character in chat');
      }

      const character = await repos.characters.findById(characterParticipant.characterId);
      if (!character) {
        return notFound('Character');
      }

      const userName = user.name || 'User';

      const formattedMessages = messages.map((msg) => ({
        id: msg.id,
        chatId,
        role: msg.role,
        content: msg.content,
        createdAt: new Date(msg.createdAt),
        updatedAt: new Date(msg.createdAt),
        swipeGroupId: msg.swipeGroupId || null,
        swipeIndex: msg.swipeIndex || null,
        tokenCount: msg.tokenCount || null,
        rawResponse: msg.rawResponse || null,
      }));

      const chatForExport = {
        ...chat,
        createdAt: new Date(chat.createdAt),
        updatedAt: new Date(chat.updatedAt),
      };

      const jsonlContent = exportSTChatAsJSONL(chatForExport, formattedMessages, character.name, userName);
      const chatCreatedTime = new Date(chat.createdAt).getTime();
      const filename = `${character.name}_chat_${chatCreatedTime}.jsonl`;

      return new NextResponse(jsonlContent, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    } catch (error) {
      logger.error('[Chats v1] Error exporting chat', { chatId }, error instanceof Error ? error : undefined);
      return serverError('Failed to export chat');
    }
  }

  // Handle get-avatars action
  if (action === 'get-avatars') {
    return handleGetAvatars(chatId, ctx);
  }

  // Handle cost action
  if (action === 'cost') {
    try {
      const chat = await repos.chats.findById(chatId);
      if (!chat) {
        return notFound('Chat');
      }
      if (chat.userId !== user.id) {
        return forbidden();
      }

      const searchParams = req.nextUrl.searchParams;
      const detailed = searchParams.get('detailed') === 'true';

      const breakdown = detailed
        ? await getDetailedChatCostBreakdown(chatId, user.id)
        : await getChatCostBreakdown(chatId, user.id);

      logger.debug('[Chats v1] Cost breakdown retrieved', {
        chatId,
        totalTokens: breakdown.totalTokens,
        estimatedCostUSD: breakdown.estimatedCostUSD,
      });

      return NextResponse.json(breakdown);
    } catch (error) {
      logger.error('[Chats v1] Failed to get cost breakdown', { chatId }, error instanceof Error ? error : undefined);
      return serverError('Failed to get cost breakdown');
    }
  }

  // Default: get chat
  try {
    logger.debug('[Chats v1] GET chat', { chatId, userId: user.id });

    const chatMetadata = await repos.chats.findById(chatId);
    if (!chatMetadata || chatMetadata.userId !== user.id) {
      return notFound('Chat');
    }

    const enrichedParticipants = await Promise.all(
      chatMetadata.participants.map((p) => enrichParticipantDetail(p, repos))
    );

    const chatEvents = await repos.chats.getMessages(chatId);
    const messages = await Promise.all(
      chatEvents
        .filter((event) => event.type === 'message')
        .map(async (event) => {
          if (event.type !== 'message') return null;

          const linkedFiles = await repos.files.findByLinkedTo(event.id);
          const attachments = linkedFiles.map((file) => ({
            id: file.id,
            filename: file.originalFilename,
            filepath: getFilePath(file),
            mimeType: file.mimeType,
          }));

          return {
            id: event.id,
            role: event.role,
            content: event.content,
            tokenCount: event.tokenCount || null,
            promptTokens: event.promptTokens || null,
            completionTokens: event.completionTokens || null,
            createdAt: event.createdAt,
            swipeGroupId: event.swipeGroupId || null,
            swipeIndex: event.swipeIndex || null,
            participantId: event.participantId || null,
            attachments,
            debugMemoryLogs: event.debugMemoryLogs || undefined,
          };
        })
    ).then((results) => results.filter(Boolean));

    let projectName: string | null = null;
    if (chatMetadata.projectId) {
      try {
        const project = await repos.projects.findById(chatMetadata.projectId);
        if (project) {
          projectName = project.name;
        }
      } catch {
        // Project might have been deleted
      }
    }

    const chat = {
      id: chatMetadata.id,
      title: chatMetadata.title,
      contextSummary: chatMetadata.contextSummary,
      roleplayTemplateId: chatMetadata.roleplayTemplateId,
      lastTurnParticipantId: chatMetadata.lastTurnParticipantId ?? null,
      isPaused: chatMetadata.isPaused ?? false,
      isManuallyRenamed: chatMetadata.isManuallyRenamed ?? false,
      updatedAt: chatMetadata.updatedAt,
      createdAt: chatMetadata.createdAt,
      participants: enrichedParticipants,
      user: { id: user.id, name: user.name, image: user.image },
      messages,
      projectId: chatMetadata.projectId || null,
      projectName,
    };

    return NextResponse.json({ chat });
  } catch (error) {
    logger.error('[Chats v1] Error fetching chat', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch chat');
  }
}
