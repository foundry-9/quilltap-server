/**
 * The extraction dry run (memory refactor §3.7): the live pipeline with
 * `dryRun: true`.
 *
 * Same context, same profile resolution, same clock, same passes — every turn
 * through `self-turn` / `other-turn`, then both fold passes over the history a
 * regenerate would rebuild (`other-fold` from the start, `episode-fold` over
 * the folded history), autonomous rooms included. Admission decides and writes
 * nothing; the cursors live in memory. Decisions are made as a regenerate would
 * make them: past the rows its chat wipe retires (`previewChatWipe`), and
 * against the inserts this run would already have made (the dry-run book), so
 * a later near-duplicate reinforces an earlier candidate. `quilltap memory-diff` therefore
 * reports what a regenerate would do.
 *
 * @module memory/extraction/dry-run
 */

import { listExtractionTurns } from '@/lib/services/chat-message/turn-transcript'
import { logger } from '@/lib/logger'
import { toAdmissionRow } from '../candidate'
import { createDryRunBook } from '../admission/dry-run-book'
import { previewChatWipe } from '../retire'
import type { ExtractionContext } from './context'
import type { AdmittedCandidate, PassResult } from './run'
import { runTurnExtraction, type TurnExtractionResult } from './turn'
import { runFoldCatchup } from './catchup'
import type { ExtractionCursorPass } from '@/lib/schemas/memory-extraction-cursor.types'

/** One candidate as the dry run reports it (the NDJSON `candidate` event). */
export interface ExtractedCandidate {
  /** Legacy grain label: `SELF` for a memory about its holder, `OTHER` otherwise. */
  pass: 'SELF' | 'OTHER'
  extractionPass: string
  /** What admission would do: `insert`, `insert-linked`, `reinforce`, `absorb`, `promote-and-reinforce`, `reject`. */
  decision: string
  /** The row it would fold into, when the decision folds. */
  decisionTargetId: string | null
  characterId: string
  characterName: string
  aboutCharacterId: string
  aboutCharacterName: string
  sourceMessageId: string | null
  content: string
  summary: string
  keywords: string[]
  importance: number
  kind: 'semantic' | 'episodic'
  when: string | null
  occurredAt: string | null
  narrativeTime: string | null
  entities: string[]
}

export function toExtractedCandidate(a: AdmittedCandidate): ExtractedCandidate {
  const { candidate } = a
  const row = toAdmissionRow(candidate, { occurredAt: a.occurredAt, narrativeTime: a.narrativeTime })
  const action = a.outcome.action
  return {
    pass: candidate.subject.aboutId && candidate.subject.aboutId !== candidate.subject.holderId ? 'OTHER' : 'SELF',
    extractionPass: candidate.provenance.pass,
    decision: action.kind,
    decisionTargetId: 'into' in action ? action.into : null,
    characterId: candidate.subject.holderId,
    characterName: a.holderName,
    aboutCharacterId: candidate.subject.aboutId ?? candidate.subject.holderId,
    aboutCharacterName: a.aboutName,
    sourceMessageId: candidate.provenance.sourceMessageId,
    content: row.content,
    summary: row.summary,
    keywords: row.keywords ?? [],
    importance: candidate.importance,
    kind: candidate.kind,
    when: candidate.when,
    occurredAt: a.occurredAt,
    narrativeTime: a.narrativeTime,
    entities: candidate.entities,
  }
}

export interface DryRunHooks {
  /** The run is about to start: how many turns it will read. */
  onStart?(turnCount: number): void
  onTurn?(index: number, total: number, result: TurnExtractionResult): void
  onTurnError?(index: number, total: number, sourceMessageId: string | null, error: string): void
  onFold?(pass: ExtractionCursorPass, result: PassResult & { skippedReason?: string; slices: number }): void
  /** Polled between units; true stops the run (the client went away). */
  isCancelled?(): boolean
}

/**
 * Run the whole chat through the pipeline without writing. `ctx` must have
 * been built with `dryRun: true`. Turns run `concurrency` at a time; the fold
 * passes run after every turn, as a regenerate's catch-ups do.
 */
export async function runExtractionDryRun(
  ctx: ExtractionContext,
  options: { concurrency?: number; hooks?: DryRunHooks } = {},
): Promise<{ turns: number; candidates: number }> {
  if (!ctx.dryRun) throw new Error('runExtractionDryRun needs a dry-run extraction context')
  const hooks = options.hooks ?? {}
  // Decide as a regenerate would: past the rows its wipe retires, and against
  // the inserts this run would already have made.
  if (!ctx.dryRunBook) {
    let retiring: Set<string> = new Set()
    try {
      retiring = await previewChatWipe(ctx.chat.id)
    } catch (error) {
      // A preview that cannot read the chat's rows decides against them as they stand.
      logger.warn('[Memory] Dry run could not preview the chat wipe; deciding against current rows', {
        chatId: ctx.chat.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    ctx.dryRunBook = createDryRunBook(retiring)
  }
  const cancelled = () => hooks.isCancelled?.() === true
  const turns = listExtractionTurns(await ctx.messages(), ctx.chat.chatType)
  hooks.onStart?.(turns.length)
  let candidates = 0

  let next = 0
  const worker = async (): Promise<void> => {
    while (!cancelled()) {
      const i = next++
      if (i >= turns.length) return
      try {
        const result = await runTurnExtraction(ctx, turns[i])
        candidates += result.admitted.length
        hooks.onTurn?.(i, turns.length, result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('[Memory] Dry-run turn failed', { chatId: ctx.chat.id, index: i, error: message })
        hooks.onTurnError?.(i, turns.length, turns[i].turnOpenerMessageId ?? turns[i].extractionAnchorMessageId ?? null, message)
      }
    }
  }
  const workers = Math.max(1, Math.min(options.concurrency ?? 4, turns.length || 1))
  await Promise.all(Array.from({ length: workers }, () => worker()))

  for (const pass of ['other-fold', 'episode-fold'] as const) {
    if (cancelled()) break
    const result = await runFoldCatchup(ctx, pass, { ignoreIdle: true, maxSlices: Number.POSITIVE_INFINITY })
    candidates += result.admitted.length
    hooks.onFold?.(pass, result)
  }

  logger.info('[Memory] Extraction dry run complete', { chatId: ctx.chat.id, turns: turns.length, candidates })
  return { turns: turns.length, candidates }
}
