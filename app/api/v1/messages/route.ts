/**
 * Messages API v1 - Collection Endpoint
 *
 * GET /api/v1/messages?chatId= - List messages for a chat
 * POST /api/v1/messages - Send a message (returns streaming SSE response)
 *
 * The POST endpoint returns Server-Sent Events for real-time streaming.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { handleSendMessage, sendMessageSchema, continueMessageSchema } from '@/lib/services/chat-message';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses';

// Extended schema that includes chatId
const sendMessageWithChatIdSchema = sendMessageSchema.extend({
  chatId: z.string().uuid('Chat ID is required'),
});

const continueMessageWithChatIdSchema = continueMessageSchema.extend({
  chatId: z.string().uuid('Chat ID is required'),
});

/**
 * GET /api/v1/messages?chatId= - List messages for a chat
 */
export const GET = createAuthenticatedHandler(async (req, { user, repos }) => {
  const url = new URL(req.url);
  const chatId = url.searchParams.get('chatId');

  if (!chatId) {
    return badRequest('Query parameter required: chatId');
  }

  try {
    logger.debug('[Messages API v1] GET messages', {
      chatId,
      userId: user.id,
    });

    // Verify chat ownership
    const chat = await repos.chats.findById(chatId);
    if (!chat || chat.userId !== user.id) {
      return notFound('Chat');
    }

    // Get messages
    const messages = await repos.chats.getMessages(chatId);

    // Filter to only message events (not system events, context summaries, etc.)
    const messageEvents = messages.filter((m) => m.type === 'message');

    return NextResponse.json({
      messages: messageEvents,
      count: messageEvents.length,
    });
  } catch (error) {
    logger.error('[Messages API v1] Error listing messages', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to list messages');
  }
});

/**
 * POST /api/v1/messages - Send a message and get streaming response
 *
 * Returns Server-Sent Events (SSE) stream for real-time response.
 */
export const POST = createAuthenticatedHandler(async (req, { user, repos }) => {
  try {
    // Parse request body
    const body = await req.json();
    const isContinueMode = body.continueMode === true;

    // Validate request based on mode
    if (isContinueMode) {
      const parsed = continueMessageWithChatIdSchema.parse(body);

      logger.debug('[Messages API v1] Continue mode request', {
        chatId: parsed.chatId,
        respondingParticipantId: parsed.respondingParticipantId,
      });

      // Verify chat ownership
      const chat = await repos.chats.findById(parsed.chatId);
      if (!chat || chat.userId !== user.id) {
        return notFound('Chat');
      }

      // Handle the message via orchestrator
      const stream = await handleSendMessage(repos, parsed.chatId, user.id, {
        continueMode: true,
        respondingParticipantId: parsed.respondingParticipantId,
      });

      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } else {
      const parsed = sendMessageWithChatIdSchema.parse(body);

      logger.debug('[Messages API v1] Send message request', {
        chatId: parsed.chatId,
        contentLength: parsed.content.length,
        fileCount: parsed.fileIds?.length || 0,
      });

      // Verify chat ownership
      const chat = await repos.chats.findById(parsed.chatId);
      if (!chat || chat.userId !== user.id) {
        return notFound('Chat');
      }

      // Handle the message via orchestrator
      const stream = await handleSendMessage(repos, parsed.chatId, user.id, {
        content: parsed.content,
        fileIds: parsed.fileIds,
        continueMode: false,
      });

      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }
  } catch (error) {
    // Handle validation errors
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    // Handle known error types
    if (error instanceof Error) {
      const message = error.message;

      // Map common errors to appropriate status codes
      if (message === 'Chat not found' || message === 'Character not found' || message === 'Connection profile not found') {
        return notFound(message);
      }

      if (message === 'No active character in chat' || message === 'No connection profile configured for character' || message === 'No API key configured for this connection profile') {
        return badRequest(message);
      }
    }

    // Generic error handling
    logger.error('[Messages API v1] Error sending message', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to send message');
  }
});
