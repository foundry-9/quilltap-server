/**
 * Chat Messages API Route
 *
 * POST /api/chats/:id/messages - Send a message and get streaming response
 *
 * This route handles HTTP concerns and delegates business logic to the
 * chat message orchestrator service.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedParamsHandler, type AuthenticatedContext } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { z } from 'zod'

import {
  handleSendMessage,
  sendMessageSchema,
  continueMessageSchema,
} from '@/lib/services/chat-message'

/**
 * POST - Send a message to a chat and receive a streaming response
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: AuthenticatedContext, { id }) => {
    try {
      // Verify chat ownership
      const chat = await repos.chats.findById(id)
      if (!chat || chat.userId !== user.id) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      }

      // Parse request body
      const body = await req.json()
      const isContinueMode = body.continueMode === true

      // Validate request based on mode
      if (isContinueMode) {
        const parsed = continueMessageSchema.parse(body)
        logger.debug('[Chat Messages API] Continue mode request', {
          chatId: id,
          respondingParticipantId: parsed.respondingParticipantId,
        })

        // Handle the message via orchestrator
        const stream = await handleSendMessage(repos, id, user.id, {
          continueMode: true,
          respondingParticipantId: parsed.respondingParticipantId,
        })

        return new NextResponse(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        })
      } else {
        const parsed = sendMessageSchema.parse(body)
        logger.debug('[Chat Messages API] Send message request', {
          chatId: id,
          contentLength: parsed.content.length,
          fileCount: parsed.fileIds?.length || 0,
        })

        // Handle the message via orchestrator
        const stream = await handleSendMessage(repos, id, user.id, {
          content: parsed.content,
          fileIds: parsed.fileIds,
          continueMode: false,
        })

        return new NextResponse(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        })
      }
    } catch (error) {
      // Handle validation errors
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation error', details: error.errors },
          { status: 400 }
        )
      }

      // Handle known error types
      if (error instanceof Error) {
        const message = error.message

        // Map common errors to appropriate status codes
        if (message === 'Chat not found' || message === 'Character not found' || message === 'Connection profile not found') {
          return NextResponse.json({ error: message }, { status: 404 })
        }

        if (message === 'No active character in chat' || message === 'No connection profile configured for character' || message === 'No API key configured for this connection profile') {
          return NextResponse.json({ error: message }, { status: 400 })
        }
      }

      // Generic error handling
      logger.error('[Chat Messages API] Error sending message', {}, error as Error)
      return NextResponse.json(
        { error: 'Failed to send message' },
        { status: 500 }
      )
    }
  }
)
