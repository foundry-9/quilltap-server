/**
 * Turn Stream — the SSE stream a Salon turn (or a chain of them) runs in.
 *
 * Every Salon stream has the same lifecycle: it runs under one turn-control
 * handle (so the operator's Stop and raised hand reach every turn it carries),
 * pings keep-alives while a turn is quiet, and on any throw emits one error
 * frame that says what of the operator's submission had already been saved.
 * `openTurnStream` is that lifecycle; the send path and the storyteller run
 * supply only the body.
 */

import { z } from 'zod'
import { createServiceLogger } from '@/lib/logging/create-logger'
import { runWithTurnControl } from '@/lib/chat/turn-control'
import { encodeErrorEvent, encodeKeepAlive, safeClose, safeEnqueue } from './streaming.service'

const logger = createServiceLogger('TurnStream')

/**
 * What of the operator's submission has reached the database during one send
 * request. Flipped by the operator-post recorder right after each write
 * succeeds and read by `handleStreamError`, so the error frame can tell the
 * Salon whether the typed text has a row to fall back on or exists only in the
 * client (bug 241). Chained turns run in continue mode and never flip it.
 */
export interface SubmissionLedger {
  userMessagePersisted: boolean
  pendingToolResultsPersisted: boolean
}

export function newSubmissionLedger(): SubmissionLedger {
  return { userMessagePersisted: false, pendingToolResultsPersisted: false }
}

/**
 * Open a Salon turn stream. `body` writes its frames to the controller; the
 * stream is closed when it returns, and an error frame is emitted (and the
 * stream closed) if it throws.
 */
export function openTurnStream(
  chatId: string,
  body: (
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder,
    ledger: SubmissionLedger
  ) => Promise<void>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const ledger = newSubmissionLedger()

  return new ReadableStream({
    async start(controller) {
      await runWithTurnControl(chatId, async () => {
        try {
          await body(controller, encoder, ledger)
          safeClose(controller)
        } catch (error) {
          handleStreamError(error, controller, encoder, { chatId, ledger })
        }
      }, { keepAlive: () => safeEnqueue(controller, encodeKeepAlive(encoder)) })
    },
  })
}

/**
 * Emit the error frame for a turn that threw, then close the stream.
 */
export function handleStreamError(
  error: unknown,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  context: { chatId: string; ledger: SubmissionLedger }
): void {
  const { chatId, ledger } = context
  logger.error('Streaming error', {
    chatId,
    userMessagePersisted: ledger.userMessagePersisted,
    pendingToolResultsPersisted: ledger.pendingToolResultsPersisted,
  }, error as Error)

  let errorMessage = 'Unknown error'
  let errorType = 'unknown'

  if (error instanceof z.ZodError) {
    const firstError = error.issues[0]
    errorMessage = firstError
      ? `Validation error: ${firstError.message} at ${firstError.path.join('.')}`
      : 'Response validation failed'
    errorType = 'validation'
  } else if (error instanceof Error) {
    errorMessage = error.message
    errorType = error.name
  }

  logger.debug('[TurnStream] Emitting error frame', {
    chatId,
    errorType,
    userMessagePersisted: ledger.userMessagePersisted,
    pendingToolResultsPersisted: ledger.pendingToolResultsPersisted,
  })
  // Safe methods: the stream may already be closed (client gone).
  safeEnqueue(controller, encodeErrorEvent(encoder, 'Failed to generate response', errorType, errorMessage, {
    userMessagePersisted: ledger.userMessagePersisted,
    pendingToolResultsPersisted: ledger.pendingToolResultsPersisted,
  }))
  safeClose(controller)
}
