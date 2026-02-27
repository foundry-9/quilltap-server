/**
 * Chats API v1 - GET Handler
 *
 * GET /api/v1/chats/[id] - Get a specific chat
 * GET /api/v1/chats/[id]?action=export - Export chat (SillyTavern JSONL)
 * GET /api/v1/chats/[id]?action=cost - Get cost breakdown
 * GET /api/v1/chats/[id]?action=get-avatars - Get avatar overrides for chat
 * GET /api/v1/chats/[id]?action=get-background - Get story background URL
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { getActionParam } from '@/lib/api/middleware/actions';
import { exportSTChatAsJSONL } from '@/lib/sillytavern/chat';
import { getChatCostBreakdown, getDetailedChatCostBreakdown } from '@/lib/services/cost-estimation.service';
import { enrichParticipantDetail } from '@/lib/services/chat-enrichment.service';
import { renderMarkdownToHtml, canPreRenderMessage } from '@/lib/services/markdown-renderer.service';
import { logger } from '@/lib/logger';
import { notFound, forbidden, serverError } from '@/lib/api/responses';
import { resolveAgentModeSetting } from '@/lib/services/chat-message/agent-mode-resolver.service';
import { handleGetAvatars, handleGetState } from '../actions';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types';

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

  // Handle get-state action
  if (action === 'get-state') {
    return handleGetState(chatId, ctx);
  }

  // Handle get-background action - returns story background URL for the chat
  if (action === 'get-background') {
    try {
      const chat = await repos.chats.findById(chatId);
      if (!chat || chat.userId !== user.id) {
        return notFound('Chat');
      }

      // Check if the chat has a story background image
      if (!chat.storyBackgroundImageId) {
        return NextResponse.json({ backgroundUrl: null, fileId: null, filename: null });
      }

      // Get the file info to build the URL
      const file = await repos.files.findById(chat.storyBackgroundImageId);
      if (!file) {
        logger.warn('[Chats v1] Story background file not found', {
          chatId,
          storyBackgroundImageId: chat.storyBackgroundImageId,
        });
        return NextResponse.json({ backgroundUrl: null, fileId: null, filename: null });
      }

      const backgroundUrl = getFilePath(file);
      return NextResponse.json({
        backgroundUrl,
        fileId: file.id,
        filename: file.originalFilename,
      });
    } catch (error) {
      logger.error('[Chats v1] Failed to get story background', { chatId }, error instanceof Error ? error : undefined);
      return serverError('Failed to get story background');
    }
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
        : await getChatCostBreakdown(chatId, user.id);return NextResponse.json(breakdown);
    } catch (error) {
      logger.error('[Chats v1] Failed to get cost breakdown', { chatId }, error instanceof Error ? error : undefined);
      return serverError('Failed to get cost breakdown');
    }
  }

  // Default: get chat
  try {

    const chatMetadata = await repos.chats.findById(chatId);
    if (!chatMetadata || chatMetadata.userId !== user.id) {
      return notFound('Chat');
    }

    const enrichedParticipants = await Promise.all(
      chatMetadata.participants.map((p) => enrichParticipantDetail(p, repos))
    );

    // Get roleplay template for rendering patterns
    let renderingPatterns: RenderingPattern[] | undefined;
    let dialogueDetection: DialogueDetection | null | undefined;

    if (chatMetadata.roleplayTemplateId) {
      const template = await repos.roleplayTemplates.findById(chatMetadata.roleplayTemplateId);
      if (template) {
        renderingPatterns = template.renderingPatterns;
        dialogueDetection = template.dialogueDetection;
      }
    }

    const chatEvents = await repos.chats.getMessages(chatId);

    // Check for TOOL messages to identify which messages have embedded tools
    const toolMessages = chatEvents.filter((event) => event.type === 'message' && event.role === 'TOOL');
    const messagesWithEmbeddedTools = new Set<string>();

    // Tool messages initiated by character get embedded in the preceding ASSISTANT message
    // Tool messages initiated by user get embedded in the following USER message
    // For simplicity, we'll skip pre-rendering for messages adjacent to TOOL messages
    const messageEvents = chatEvents.filter((event) => event.type === 'message');
    for (let i = 0; i < messageEvents.length; i++) {
      const event = messageEvents[i];
      if (event.type === 'message' && event.role === 'TOOL') {
        // Mark adjacent messages as having embedded tools
        if (i > 0) {
          const prevEvent = messageEvents[i - 1];
          if (prevEvent.type === 'message') {
            messagesWithEmbeddedTools.add(prevEvent.id);
          }
        }
        if (i < messageEvents.length - 1) {
          const nextEvent = messageEvents[i + 1];
          if (nextEvent.type === 'message') {
            messagesWithEmbeddedTools.add(nextEvent.id);
          }
        }
      }
    }

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

          // Determine if this message can be pre-rendered
          const hasAttachments = attachments.length > 0;
          const hasEmbeddedTool = messagesWithEmbeddedTools.has(event.id);
          const canPreRender = canPreRenderMessage(event.role, hasAttachments, hasEmbeddedTool);

          // Pre-render simple messages to HTML
          let renderedHtml: string | null = null;
          if (canPreRender) {
            try {
              renderedHtml = await renderMarkdownToHtml(event.content, {
                renderingPatterns,
                dialogueDetection,
              });
            } catch (err) {
              // Log but don't fail - client can still render
              logger.warn('[Chats v1] Failed to pre-render message', {
                messageId: event.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

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
            renderedHtml,
          };
        })
    ).then((results) => results.filter(Boolean));

    let projectName: string | null = null;
    let project = null;
    if (chatMetadata.projectId) {
      try {
        project = await repos.projects.findById(chatMetadata.projectId);
        if (project) {
          projectName = project.name;
        }
      } catch {
        // Project might have been deleted
      }
    }

    // Resolve agent mode through the cascade: Global → Character → Project → Chat
    let primaryCharacter = null;
    const characterParticipant = chatMetadata.participants.find(
      (p) => p.type === 'CHARACTER' && p.characterId
    );
    if (characterParticipant?.characterId) {
      try {
        primaryCharacter = await repos.characters.findById(characterParticipant.characterId);
      } catch {
        // Character might have been deleted
      }
    }

    const chatSettings = await repos.chatSettings.findByUserId(user.id);
    const resolvedAgentMode = resolveAgentModeSetting(chatMetadata, project, primaryCharacter, chatSettings);

    const chat = {
      id: chatMetadata.id,
      title: chatMetadata.title,
      contextSummary: chatMetadata.contextSummary,
      roleplayTemplateId: chatMetadata.roleplayTemplateId,
      imageProfileId: chatMetadata.imageProfileId ?? null,
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
      disabledTools: chatMetadata.disabledTools || [],
      disabledToolGroups: chatMetadata.disabledToolGroups || [],
      agentModeEnabled: chatMetadata.agentModeEnabled ?? false,
      resolvedAgentModeEnabled: resolvedAgentMode.enabled,
      agentModeSource: resolvedAgentMode.enabledSource,
    };

    return NextResponse.json({ chat });
  } catch (error) {
    logger.error('[Chats v1] Error fetching chat', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch chat');
  }
}
