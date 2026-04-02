/**
 * Chat Messages API v1 Route
 *
 * POST /api/v1/chats/[id]/messages - Send a message and get streaming response
 *
 * This route handles HTTP concerns and delegates business logic to the
 * chat message orchestrator service. Returns text/event-stream for real-time
 * LLM responses.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, type AuthenticatedContext } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { z } from 'zod';

import {
  handleSendMessage,
  sendMessageSchema,
  continueMessageSchema,
} from '@/lib/services/chat-message';
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses';
import { scrubUserAgent } from '@/lib/utils/user-agent';

/**
 * POST - Send a message to a chat and receive a streaming response
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: AuthenticatedContext, { id }) => {
    try {
      // Verify chat ownership
      const chat = await repos.chats.findById(id);
      if (!chat) {
        return notFound('Chat');
      }

      // Parse request body
      const body = await req.json();
      const isContinueMode = body.continueMode === true;

      // Capture browser User-Agent for tool use (e.g., curl)
      // Scrub Electron/Quilltap tokens so it looks like a normal browser
      const browserUserAgent = scrubUserAgent(req.headers.get('user-agent') || undefined);

      // Validate request based on mode
      if (isContinueMode) {
        const parsed = continueMessageSchema.parse(body);// Handle the message via orchestrator
        const stream = await handleSendMessage(repos, id, user.id, {
          continueMode: true,
          respondingParticipantId: parsed.respondingParticipantId,
          browserUserAgent,
        });

        return new NextResponse(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      } else {
        const parsed = sendMessageSchema.parse(body);// Handle the message via orchestrator
        const stream = await handleSendMessage(repos, id, user.id, {
          content: parsed.content,
          fileIds: parsed.fileIds,
          pendingToolResults: parsed.pendingToolResults,
          targetParticipantIds: parsed.targetParticipantIds,
          continueMode: false,
          browserUserAgent,
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
      logger.error('[Chats v1 Messages] Error sending message', { chatId: id }, error as Error);
      return serverError('Failed to send message');
    }
  }
);
