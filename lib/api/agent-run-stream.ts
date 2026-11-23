/**
 * The SSE response of an agent run that writes its own frames.
 *
 * A one-shot run (the Scenario Builder, the wardrobe and Atlas wizards) is
 * handed a controller and the request's abort signal and enqueues as it goes.
 * This is the part every such route shares: a controller that goes quiet once
 * the client has left (a cancelled stream throws on enqueue), a last-resort
 * error frame should the run throw, the close, and the event-stream headers.
 *
 * @module lib/api/agent-run-stream
 */

import { NextResponse } from 'next/server'
import type { StreamController } from '@/lib/services/chat-message/tool-execution.service'

interface AgentRunLogger {
  debug: (message: string, context?: Record<string, unknown>) => void
  error: (message: string, context?: Record<string, unknown>) => void
}

export interface AgentRunStreamOptions {
  /** What the run is called in the log, e.g. "Wardrobe design". */
  label: string
  /** What the client is told should the run throw (it should not, by contract). */
  failureMessage: string
  logger: AgentRunLogger
  run: (controller: StreamController, signal: AbortSignal) => Promise<void>
}

export function streamAgentRun(signal: AbortSignal, { label, failureMessage, logger, run }: AgentRunStreamOptions): NextResponse {
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      let closed = false
      // processToolCalls enqueues directly; a cancelled stream throws on
      // enqueue. Swallow those so a closed dialog ends the run quietly.
      const safeController: StreamController = {
        enqueue: (data: Uint8Array) => {
          if (closed || signal.aborted) return
          try {
            streamController.enqueue(data)
          } catch {
            closed = true
          }
        },
      }
      const onAbort = () => {
        logger.debug(`${label} client disconnected; aborting the run`)
        closed = true
      }
      signal.addEventListener('abort', onAbort)

      try {
        await run(safeController, signal)
      } catch (error) {
        // The run never throws by contract; this is belt and braces.
        logger.error(`${label} stream failed`, {
          error: error instanceof Error ? error.message : String(error),
        })
        safeController.enqueue(encoder.encode(`data: ${JSON.stringify({ error: failureMessage })}\n\n`))
      } finally {
        signal.removeEventListener('abort', onAbort)
        if (!closed) {
          closed = true
          try {
            streamController.close()
          } catch {
            /* already closed */
          }
        }
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
