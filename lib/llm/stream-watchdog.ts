/**
 * Stall watchdog for provider streams.
 *
 * A provider that accepts a streaming request, answers with headers, and then
 * sends no body is indistinguishable — from the consumer's side — from one that
 * is thinking hard. The `for await` simply never advances. Nothing below us
 * catches it: an SDK-backed provider's own `timeout` stops at the response
 * headers (see `packages/plugin-utils/src/providers/request-budget.ts` and
 * `LLMParams.requestTimeoutMs`), which is what makes it safe to apply on a
 * streaming path and useless once the headers have landed.
 *
 * So the budget has to live where the chunks are counted. This wraps a
 * provider's chunk stream and gives each `next()` a deadline: a generous one
 * for the first chunk, a tighter one between chunks, since a stream that has
 * started is already past the slow part.
 *
 * As with `withTimeout`, the abandoned request is NOT cancelled — the plugin
 * owns its SDK client and its socket, and a generator suspended at an `await`
 * cannot be resumed from outside. We stop *waiting*, which is the part that
 * holds a turn (or a whole chat creation) open. The orphaned iterator is asked
 * to unwind, and does so if the provider ever speaks again.
 *
 * @module llm/stream-watchdog
 */

import { logger } from '@/lib/logger'
import { withTimeout } from '@/lib/promise-timeout'

/**
 * Budget for the first chunk of a stream — the model's whole time-to-first-
 * token, which on a long context with extended thinking is legitimately minutes.
 * Deliberately generous: a false positive here aborts a turn that was working.
 */
export const DEFAULT_FIRST_CHUNK_TIMEOUT_MS = 240_000

/**
 * Budget between chunks. Once a stream is flowing the gaps are small — a model
 * still in its thinking phase is emitting reasoning deltas, which count as
 * chunks like any other — so this is much tighter than the first-chunk budget.
 */
export const DEFAULT_IDLE_CHUNK_TIMEOUT_MS = 120_000

/**
 * Raised when a provider stream stops producing chunks inside its budget.
 *
 * Named, not just messaged, so callers can tell "the provider went quiet" apart
 * from "the provider said no" — the greeting ladder abandons its retries on
 * this one, and `classifyFallbackTrigger` reads it as `network`.
 */
export class LLMStreamStalledError extends Error {
  constructor(
    public readonly budgetMs: number,
    public readonly chunksReceived: number,
    public readonly provider?: string,
    public readonly modelName?: string
  ) {
    const where = chunksReceived === 0
      ? `never sent a first chunk within ${budgetMs}ms`
      : `went quiet for ${budgetMs}ms after ${chunksReceived} chunk(s)`
    super(`Provider stream ${where}`)
    this.name = 'LLMStreamStalledError'
  }
}

export interface StallWatchdogOptions {
  /** Override the first-chunk budget. */
  firstChunkTimeoutMs?: number
  /** Override the between-chunks budget. */
  idleTimeoutMs?: number
  /** Provider / model, for the error and the log line. */
  provider?: string
  modelName?: string
  /** Extra fields for the log line when the watchdog fires. */
  logContext?: Record<string, unknown>
}

/**
 * Wrap a provider chunk stream so a silent provider fails instead of hanging.
 *
 * Yields the source's chunks untouched; throws `LLMStreamStalledError` the
 * moment one is overdue.
 */
export async function* withStallWatchdog<T>(
  source: AsyncIterable<T>,
  options: StallWatchdogOptions = {}
): AsyncGenerator<T> {
  const firstChunkTimeoutMs = options.firstChunkTimeoutMs ?? DEFAULT_FIRST_CHUNK_TIMEOUT_MS
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_CHUNK_TIMEOUT_MS

  const iterator = source[Symbol.asyncIterator]()
  const startedAt = Date.now()
  let chunksReceived = 0
  let stalled = false

  try {
    for (;;) {
      const budgetMs = chunksReceived === 0 ? firstChunkTimeoutMs : idleTimeoutMs

      let result: IteratorResult<T>
      try {
        result = await withTimeout(
          iterator.next(),
          budgetMs,
          () => new LLMStreamStalledError(budgetMs, chunksReceived, options.provider, options.modelName)
        )
      } catch (error) {
        if (error instanceof LLMStreamStalledError) {
          stalled = true
          logger.warn('[LLMStream] Abandoned a stalled provider stream', {
            ...options.logContext,
            provider: options.provider,
            modelName: options.modelName,
            budgetMs,
            chunksReceived,
            elapsedMs: Date.now() - startedAt,
          })
        }
        throw error
      }

      if (result.done) return
      chunksReceived++
      yield result.value
    }
  } finally {
    // Ask the source to unwind: on an early `break` by our own consumer (Stop,
    // a tool loop cutting the turn short) this is what closes the provider's
    // stream, so it is awaited. On a stall it is exactly the thing that cannot
    // be awaited — the generator is suspended at an `await` that never settles,
    // so its `return()` is queued behind a promise that never resolves, and
    // awaiting it here would reproduce the hang this wrapper exists to end.
    const unwound = Promise.resolve(iterator.return?.()).catch(() => {})
    if (stalled) {
      void unwound
    } else {
      await unwound
    }
  }
}
