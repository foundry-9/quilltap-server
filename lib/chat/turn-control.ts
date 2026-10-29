/**
 * Turn control — the operator's two ways of cutting in on a Salon chain.
 *
 * A Salon send runs its whole chain of character turns inside one SSE stream
 * (`handleSendMessage` → `executeTurnChain`). While that stream is open the
 * operator can:
 *
 *   - **Raise a hand** (soft interrupt). The next character to take the floor
 *     is asked, in its own turn prompt, whether to yield to the operator
 *     (`[YIELD]`) or carry on regardless. The hand is consumed by that one
 *     turn; a decline lowers it silently. See `yield-signal.ts`.
 *   - **Stop** (hard interrupt). The in-flight provider stream is abandoned at
 *     once; whatever prose had already streamed is kept as the character's
 *     reply, tools already run stay run, and no further tool call, recovery
 *     retry or chained turn starts.
 *
 * Each open stream registers a handle here for its lifetime
 * (`runWithTurnControl`), and the handle is also the ambient
 * `AsyncLocalStorage` store, so code deep in the turn (`streamMessage`, the
 * tool loops, the finalizer) asks about *its own* stream without a chatId
 * lookup — a stop aimed at a stream that is still winding down never touches
 * a fresh send made a moment later.
 *
 * The HTTP actions (`?action=stop-turn`, `?action=raise-hand`) run in a
 * different route bundle from the SSE stream, so the registry is a
 * `processSingleton` (bug 235). It is in-process only: autonomous-room turns
 * run in the job child, where nothing ever stops or interrupts them.
 *
 * Server-only (`node:async_hooks`).
 *
 * @module chat/turn-control
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { logger } from '@/lib/logger'
import { processSingleton } from '@/lib/utils/process-singleton'

interface TurnControlEntry {
  readonly chatId: string
  readonly controller: AbortController
  /** The operator's hand is up and no character has been asked yet. */
  handRaised: boolean
  /** Resolves when the stream's work has finished, stopped or not. */
  readonly settled: Promise<void>
  readonly settle: () => void
  /**
   * Send one SSE keep-alive ping down this stream; false once it has closed.
   * For work that waits a long time inside a turn with nothing to say — a
   * custom-tool run held for the operator (lib/pascal/intervention/).
   */
  readonly keepAlive?: () => boolean
}

interface TurnControlState {
  byChat: Map<string, Set<TurnControlEntry>>
  als: AsyncLocalStorage<TurnControlEntry>
}

const state = processSingleton<TurnControlState>('chat.turnControl', () => ({
  byChat: new Map(),
  als: new AsyncLocalStorage<TurnControlEntry>(),
}))

/**
 * Run one Salon stream's work under a turn-control handle. Everything `fn`
 * awaits inherits the handle; it is unregistered (and its `settled` promise
 * resolved) when `fn` finishes, however it finishes.
 */
export async function runWithTurnControl<T>(
  chatId: string,
  fn: () => Promise<T>,
  options: { keepAlive?: () => boolean } = {}
): Promise<T> {
  let settle: () => void = () => {}
  const settled = new Promise<void>((resolve) => { settle = resolve })
  const entry: TurnControlEntry = {
    chatId,
    controller: new AbortController(),
    handRaised: false,
    settled,
    settle,
    ...(options.keepAlive ? { keepAlive: options.keepAlive } : {}),
  }

  let entries = state.byChat.get(chatId)
  if (!entries) {
    entries = new Set()
    state.byChat.set(chatId, entries)
  }
  entries.add(entry)
  logger.debug('[TurnControl] Stream registered', { chatId, openStreams: entries.size })

  try {
    return await state.als.run(entry, fn)
  } finally {
    entries.delete(entry)
    if (entries.size === 0) state.byChat.delete(chatId)
    entry.settle()
    logger.debug('[TurnControl] Stream unregistered', {
      chatId,
      stopped: entry.controller.signal.aborted,
      openStreams: entries.size,
    })
  }
}

/**
 * The stop signal of the stream this code is running inside, or undefined
 * outside a registered Salon stream (Carina's own surfaces, the Console,
 * autonomous rooms in the job child).
 */
export function currentTurnStopSignal(): AbortSignal | undefined {
  return state.als.getStore()?.controller.signal
}

/**
 * The keep-alive ping of the stream this code is running inside, or undefined
 * outside a registered Salon stream (or one registered without a pinger).
 */
export function currentTurnKeepAlive(): (() => boolean) | undefined {
  return state.als.getStore()?.keepAlive
}

/** Has the operator hard-stopped the stream this code is running inside? */
export function isCurrentTurnStopped(): boolean {
  return state.als.getStore()?.controller.signal.aborted === true
}

/**
 * Consume the operator's raised hand for the turn about to be built. Returns
 * true at most once per raise: the first character asked is the only one
 * asked. A stopped stream never offers a yield.
 */
export function takeRaisedHand(): boolean {
  const entry = state.als.getStore()
  if (!entry || !entry.handRaised || entry.controller.signal.aborted) return false
  entry.handRaised = false
  logger.debug('[TurnControl] Raised hand consumed by the next speaker', { chatId: entry.chatId })
  return true
}

/** Is any Salon stream open for this chat in this process? */
export function hasActiveTurn(chatId: string): boolean {
  return (state.byChat.get(chatId)?.size ?? 0) > 0
}

/**
 * Wait until every stream that opened for this chat BEFORE the calling one has
 * finished. A whisper uses this to queue behind a chain already running rather
 * than start a second speaker beside it (bug 258).
 *
 * Only earlier streams are awaited (a `Set` iterates in insertion order), so
 * two waiting streams can never wait on each other. A stream opened later is
 * none of this one's business. Called outside a registered stream, it waits on
 * every open stream for the chat. Returns how many streams it waited on.
 */
export async function waitForEarlierTurns(chatId: string): Promise<number> {
  const self = state.als.getStore()
  const earlier: TurnControlEntry[] = []
  for (const entry of state.byChat.get(chatId) ?? []) {
    if (entry === self) break
    earlier.push(entry)
  }
  if (earlier.length === 0) return 0

  logger.debug('[TurnControl] Waiting for earlier stream(s) to finish', { chatId, streams: earlier.length })
  await Promise.all(earlier.map((e) => e.settled))
  logger.debug('[TurnControl] Earlier stream(s) finished', { chatId, streams: earlier.length })
  return earlier.length
}

/**
 * Raise (or lower) the operator's hand on every open stream for the chat.
 * Returns how many streams heard it — zero means nothing was running, and the
 * floor is already the operator's.
 */
export function setHandRaised(chatId: string, raised: boolean): number {
  const entries = state.byChat.get(chatId)
  if (!entries) return 0
  let count = 0
  for (const entry of entries) {
    if (entry.controller.signal.aborted) continue
    entry.handRaised = raised
    count++
  }
  logger.debug('[TurnControl] Hand state set', { chatId, raised, streams: count })
  return count
}

export interface StopActiveTurnsResult {
  /** How many open streams were told to stop. */
  stopped: number
  /** Whether every stopped stream finished its cleanup inside the timeout. */
  settled: boolean
}

/**
 * Hard-stop every open stream for the chat and wait (bounded) for them to
 * finish saving what they had. The caller sets any pause *before* calling,
 * so the chain's next decision already reads it.
 */
export async function stopActiveTurns(
  chatId: string,
  options: { settleTimeoutMs?: number } = {},
): Promise<StopActiveTurnsResult> {
  const entries = Array.from(state.byChat.get(chatId) ?? [])
  if (entries.length === 0) {
    logger.debug('[TurnControl] Stop requested with no open stream', { chatId })
    return { stopped: 0, settled: true }
  }

  for (const entry of entries) {
    entry.handRaised = false
    entry.controller.abort()
  }
  logger.info('[TurnControl] Stopping open Salon stream(s)', { chatId, streams: entries.length })

  const timeoutMs = options.settleTimeoutMs ?? 15_000
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  const settled = await Promise.race([
    Promise.all(entries.map((e) => e.settled)).then(() => true as const),
    timedOut,
  ])
  if (timer) clearTimeout(timer)

  if (!settled) {
    logger.warn('[TurnControl] Stopped stream(s) did not settle in time', { chatId, timeoutMs })
  }
  return { stopped: entries.length, settled }
}
