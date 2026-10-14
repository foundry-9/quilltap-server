/**
 * The fold-grain runner (memory refactor §3.7): one way the `other-fold` and
 * `episode-fold` passes read a stretch of a chat.
 *
 *  1. **Range.** From the pass's cursor through the end of the window it was
 *     handed (`foldPassRange`), so a slice an earlier run lost to a timeout is
 *     read before a newer window, never jumped; a fold that re-walks old turns
 *     (a summary rebuild) never re-reads what the pass has covered.
 *  2. **Slices.** The eligible messages in consecutive slices of
 *     {@link FOLD_MAX_WINDOW_MESSAGES}, at most `maxSlices` per run (the rest
 *     waits for the next fold or catch-up job, from the advanced cursor).
 *  3. **Cursor.** Advanced past each slice as it is read — only ever past
 *     messages the window covered (bugs 206, 207). A slice lost to a timeout
 *     stops the run there and leaves the cursor before it.
 *
 * Best-effort: never throws into the fold; the result says what happened.
 *
 * @module memory/extraction/fold
 */

import type { MessageEvent } from '@/lib/schemas/types'
import type { FoldCursorPass } from '@/lib/schemas/memory-extraction-cursor.types'
import { logger } from '@/lib/logger'
import type { ExtractionContext } from './context'
import { emptyPassResult, mergePassResult, runPass, type ExtractionPass, type PassResult } from './run'
import { foldPassRange, isFoldEligibleMessage, sliceFoldWindow, stretchWindow } from './window'
import { otherFoldPass } from './passes/other-fold'
import { episodeFoldPass } from './passes/episode-fold'

/** One prompt reads at most this many eligible messages; a wider window is read in consecutive slices of it. */
export const FOLD_MAX_WINDOW_MESSAGES = 60

/** One run reads at most this many slices by default; a longer backlog continues from the advanced cursor. */
export const FOLD_MAX_SLICES_PER_JOB = 4

export interface RunFoldInput {
  /** The stretch the fold (or catch-up) hands over: chronological, any rows (ineligible ones are skipped). */
  windowMessages: MessageEvent[]
  /** The message the cursor may advance to after the last slice. Defaults to the last window message. */
  coverThroughMessageId?: string | null
  /** Slices read this run (default {@link FOLD_MAX_SLICES_PER_JOB}; a dry run reads them all). */
  maxSlices?: number
}

export interface FoldResult extends PassResult {
  /**
   * Set when the pass did nothing on purpose or could not run: `mode-turn`, `empty-window`,
   * `behind-cursor`, `nothing-to-observe`, `nobody-present`, `rate-limited` (a slice's holders
   * were all at the hourly cap; it and the rest are left unread), `error`; catch-ups add
   * `not-idle` and `never-folded`.
   */
  skippedReason?: string
  /** Slices read. */
  slices: number
  /** Slices left unread because the run hit `maxSlices`. */
  slicesDeferred: number
  /** Where the cursor now stands, when this run moved it. */
  cursorAdvancedTo: string | null
}

function foldResult(pass: FoldCursorPass, skippedReason?: string): FoldResult {
  return {
    ...emptyPassResult(pass),
    slices: 0,
    slicesDeferred: 0,
    cursorAdvancedTo: null,
    ...(skippedReason ? { skippedReason } : {}),
  }
}

function passFor(name: FoldCursorPass): ExtractionPass {
  return name === 'other-fold' ? otherFoldPass() : episodeFoldPass()
}

async function advance(ctx: ExtractionContext, pass: FoldCursorPass, messageId: string | null, result: FoldResult): Promise<void> {
  if (!messageId) return
  try {
    await ctx.cursors.advance(pass, messageId)
    result.cursorAdvancedTo = messageId
  } catch (error) {
    logger.warn('[Memory] Failed to advance extraction cursor', {
      chatId: ctx.chat.id,
      pass,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Run one fold-grain pass over a window. See module docs. */
export async function runFoldPass(
  ctx: ExtractionContext,
  passName: FoldCursorPass,
  input: RunFoldInput,
): Promise<FoldResult> {
  const chatId = ctx.chat.id
  // Kept outside the try, so a throw mid-run still reports what earlier slices
  // did — the cursor they advanced, the slices left, the tokens spent.
  const result = foldResult(passName)
  /** Slices of this run not yet read; a throw leaves them to a successor job. */
  let unread = 0
  try {
    if (passName === 'other-fold' && ctx.settings.mode.otherPass === 'turn') {
      logger.debug('[Memory] otherPass=turn; fold-grain OTHER pass not run', { chatId })
      return foldResult(passName, 'mode-turn')
    }
    if (input.windowMessages.length === 0) return foldResult(passName, 'empty-window')

    const cursor = await ctx.cursors.read(passName)
    let window = input.windowMessages
    if (cursor.afterMessageId) {
      const range = foldPassRange(window, await ctx.messages(), cursor.afterMessageId)
      if (range.applied) {
        logger.debug('[Memory] Fold window cut to what lies past the cursor', {
          chatId,
          pass: passName,
          cursor: cursor.afterMessageId,
          before: window.length,
          after: range.messages.length,
          gap: range.gap,
        })
        window = range.messages
        if (window.length === 0) return foldResult(passName, 'behind-cursor')
      }
    }

    const coverThrough = input.coverThroughMessageId ?? window[window.length - 1]?.id ?? null
    const eligible = window.filter(isFoldEligibleMessage)
    const allSlices = sliceFoldWindow(eligible, FOLD_MAX_WINDOW_MESSAGES, coverThrough)
    const maxSlices = input.maxSlices ?? FOLD_MAX_SLICES_PER_JOB
    const slices = allSlices.slice(0, maxSlices)
    result.slicesDeferred = allSlices.length - slices.length
    unread = slices.length
    if (result.slicesDeferred > 0) {
      logger.info('[Memory] Fold backlog wider than one run; the rest waits for the next fold or catch-up', {
        chatId,
        pass: passName,
        slicesRead: slices.length,
        slicesDeferred: result.slicesDeferred,
      })
    }

    if (slices.length === 0) {
      result.skippedReason = 'nothing-to-observe'
      await advance(ctx, passName, coverThrough, result)
      return result
    }

    const pass = passFor(passName)
    let slicesWithNoCalls = 0
    for (let i = 0; i < slices.length; i++) {
      const slice = slices[i]
      const sliceResult = await runPass(
        pass,
        ctx,
        stretchWindow(slice.messages, ctx.speakerNames, slice.coverThroughMessageId),
        { deferOnRateLimit: true },
      )
      mergePassResult(result, sliceResult)
      if (sliceResult.rateDeferred) {
        // Not read: the cursor stays before this slice, and the next fold or
        // catch-up reads it once the hour has passed.
        result.skippedReason = 'rate-limited'
        result.slicesDeferred += slices.length - i
        unread = 0
        logger.info('[Memory] Fold slice deferred by the rate limit; cursor not advanced past it', {
          chatId,
          pass: passName,
          slice: i + 1,
          slices: slices.length,
        })
        break
      }
      result.slices++
      unread--
      if (sliceResult.calls === 0 && sliceResult.timedOut === 0) slicesWithNoCalls++
      if (sliceResult.timedOut > 0) {
        logger.warn('[Memory] Fold slice lost to a timeout; cursor not advanced past it', {
          chatId,
          pass: passName,
          slice: i + 1,
          slices: slices.length,
        })
        break
      }
      await advance(ctx, passName, slice.coverThroughMessageId, result)
    }
    if (!result.rateDeferred && slicesWithNoCalls === result.slices && result.timedOut === 0) {
      result.skippedReason = passName === 'episode-fold' ? 'nobody-present' : 'nothing-to-observe'
    }

    logger.info('[Memory] Fold pass complete', {
      chatId,
      pass: passName,
      dryRun: ctx.dryRun,
      slices: result.slices,
      calls: result.calls,
      candidates: result.admitted.length,
      created: result.createdIds.length,
      reinforced: result.reinforcedIds.length,
      cursorAdvancedTo: result.cursorAdvancedTo,
    })
    return result
  } catch (error) {
    logger.warn('[Memory] Fold pass failed (non-fatal)', {
      chatId,
      pass: passName,
      slicesRead: result.slices,
      cursorAdvancedTo: result.cursorAdvancedTo,
      error: error instanceof Error ? error.message : String(error),
    })
    result.skippedReason = 'error'
    // The slice that threw and those after it are unread; a catch-up job that
    // advanced the cursor first hands them to its successor.
    result.slicesDeferred += unread
    return result
  }
}
