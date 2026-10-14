/**
 * Regenerate-Swipe Stream — a swipe regeneration narrated as an SSE stream.
 *
 * One transport for every way a line gets re-rolled: the ordinary regenerate
 * (`POST /api/v1/messages/[id]?action=swipe&stream=1`) and the Concierge's
 * "Try uncensored" (`POST /api/v1/chats/[id]/messages/[messageId]?action=retry-uncensored`).
 * Each step is reported as it happens — a `status` line, `content` deltas
 * (append) and cumulative `reasoning` (replace) — then a final `done` carrying
 * the persisted swipe. A failure after the stream has opened is an `error`
 * event, because the headers are long gone; a caller that can refuse the
 * request outright must do so *before* calling this.
 *
 * @module services/chat-message/regenerate-swipe-stream
 */

import type { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { regenerateMessageAsSwipe, type RegenerateSwipeOptions } from './regenerate-swipe.service'
import {
  encodeContentChunk,
  encodeReasoningChunk,
  encodeStatusEvent,
  encodeErrorEvent,
  safeClose,
  safeEnqueue,
} from './streaming.service'
import { sseStreamResponse } from './request-helpers'

export function streamSwipeRegeneration(
  options: Omit<RegenerateSwipeOptions, 'onProgress'>,
  logContext: string,
): NextResponse {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const newSwipe = await regenerateMessageAsSwipe({
          ...options,
          onProgress: (event) => {
            if (event.kind === 'status') {
              safeEnqueue(controller, encodeStatusEvent(encoder, event))
            } else if (event.kind === 'delta') {
              safeEnqueue(controller, encodeContentChunk(encoder, event.content))
            } else {
              safeEnqueue(controller, encodeReasoningChunk(encoder, event.reasoning))
            }
          },
        })

        safeEnqueue(
          controller,
          encoder.encode(`data: ${JSON.stringify({ done: true, message: newSwipe })}\n\n`)
        )
      } catch (error) {
        logger.error(
          `${logContext} Streaming swipe generation failed`,
          { messageId: options.targetMessage.id, chatId: options.chat.id },
          error instanceof Error ? error : undefined
        )
        safeEnqueue(
          controller,
          encodeErrorEvent(
            encoder,
            'Failed to generate alternative response',
            'regenerate_failed',
            error instanceof Error ? error.message : String(error)
          )
        )
      } finally {
        safeClose(controller)
      }
    },
  })

  return sseStreamResponse(stream)
}
