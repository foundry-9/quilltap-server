/**
 * Stage 8 — deliver: the only writer of "what was shown".
 *
 * Runs after the request body is assembled — after Phase-2 memory compression
 * has had its say — with the text that actually goes to the model. A rendered
 * line counts as delivered only when its memory's words are still in that text
 * (a line compression cut is not delivered). For what was delivered, and only
 * that, it:
 *
 * - stamps `lastAccessedAt` (the recent-access term of `protection`);
 * - appends the head's ids to the chat's anti-repetition ring, and the
 *   retrospective mini-recap's signature to its spam guard;
 * - writes the turn's debug record (the stage trace, the delivered pools and a
 *   machine-readable ring line the replay reads back).
 *
 * A search never stamps anything: the head over-fetches about three times what
 * it shows, and stamping every candidate once left 83% of a corpus "recently
 * accessed".
 *
 * @module memory/recall/deliver
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { significantQueryWords } from './gather'
import { appendRecallTurn, appendRetroSignature } from './history'
import type { RecallBundle } from './assemble'
import type { RecallPool, RecallTrace, RenderedLine } from './types'

/** Every recall debug line starts with this. */
export const RECALL_DEBUG_PREFIX = '[Recall]'
/** The machine-readable line carrying the head ids delivered this turn. */
export const RECALL_RING_PREFIX = '[Recall:ring]'

/**
 * Stamp `lastAccessedAt` on rows a consumer actually used — whispered into a
 * prompt, returned to a model as tool output, shown to an answerer. The one
 * writer of the column. Character-scoped and fire-and-forget: a missed stamp
 * must never fail a turn.
 */
export function stampAccessed(characterId: string, memoryIds: readonly string[]): void {
  const ids = Array.from(new Set(memoryIds.filter(id => typeof id === 'string' && id.length > 0)))
  if (ids.length === 0) return
  logger.debug('[Recall] Stamping delivered memories accessed', { characterId, count: ids.length })
  const warn = (err: unknown) => {
    logger.warn('[Recall] Failed to stamp lastAccessedAt on delivered memories', {
      characterId,
      count: ids.length,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  try {
    getRepositories().memories.updateAccessTimeBulk(characterId, ids).catch(warn)
  } catch (err) {
    warn(err)
  }
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** How much of a line's significant words one delivered line must hold to count as carrying it. */
export const SURVIVAL_WORD_SHARE = 0.6

/**
 * The rendered lines whose memory reached the model. A line survives when its
 * body is in the delivered text verbatim (whitespace and case aside) — always
 * the case without compression — or, after a compression rewrite, when one
 * delivered line holds at least {@link SURVIVAL_WORD_SHARE} of its significant
 * words (three or more of them). A line compression dropped is not delivered.
 */
export function survivingLines(lines: readonly RenderedLine[], deliveredText: string): RenderedLine[] {
  if (!deliveredText) return []
  const whole = normalise(deliveredText)
  const deliveredLines = deliveredText.split('\n').map(l => new Set(significantQueryWords(l.replace(/[^\p{L}\p{N}\s'-]/gu, ' '))))
  return lines.filter(line => {
    const body = normalise(line.body)
    if (body.length > 0 && whole.includes(body)) return true
    const words = [...new Set(significantQueryWords(line.body.replace(/[^\p{L}\p{N}\s'-]/gu, ' ')))]
    if (words.length < 3) return false
    return deliveredLines.some(set => words.filter(w => set.has(w)).length / words.length >= SURVIVAL_WORD_SHARE)
  })
}

/** What a turn's delivery did. */
export interface RecallDelivery {
  /** Ids delivered, by pool. */
  delivered: Partial<Record<RecallPool, string[]>>
  /** Ids rendered but not delivered (cut by compression). */
  lost: string[]
  /** The lines for the assistant message's `debugMemoryLogs`. */
  debugLog: string[]
}

export interface DeliverOptions {
  characterId: string
  chat: { id: string; commonplaceRecallHistory?: unknown }
  /** The recall text the request body carries (the trailing section). */
  deliveredText: string
  /** Record the head in the anti-repetition ring (off for the replay). */
  persistRing?: boolean
}

/** Render a stage trace as debug lines. */
export function traceLines(trace: RecallTrace): string[] {
  return trace.map(entry =>
    `${RECALL_DEBUG_PREFIX} ${entry.stage}${entry.label ? ` (${entry.label})` : ''}: ${JSON.stringify(entry.detail)}`,
  )
}

/**
 * Deliver a turn's recall bundle: decide what reached the model, stamp it,
 * record the head in the ring, and compose the debug record.
 */
export async function deliverRecall(bundle: RecallBundle, opts: DeliverOptions): Promise<RecallDelivery> {
  const delivered: Partial<Record<RecallPool, string[]>> = {}
  const lost: string[] = []
  for (const [pool, lines] of Object.entries(bundle.lines) as Array<[RecallPool, RenderedLine[]]>) {
    if (!lines || lines.length === 0) continue
    const kept = survivingLines(lines, opts.deliveredText)
    const keptIds = new Set(kept.map(l => l.memoryId))
    delivered[pool] = [...keptIds]
    for (const line of lines) if (!keptIds.has(line.memoryId)) lost.push(line.memoryId)
  }
  // The recap is a narrative, not lines: the rows it summarised did not reach
  // the model in their own words, so they are not stamped (only the ones a
  // line-rendered pool delivered are).

  stampAccessed(opts.characterId, Object.values(delivered).flat())

  const head = delivered.head ?? []
  const retroDelivered = !!bundle.sections.retrospective && opts.deliveredText.includes(bundle.sections.retrospective)
  const signature = retroDelivered ? bundle.retroSignature : null
  if (opts.persistRing !== false && (head.length > 0 || signature)) {
    try {
      let next = appendRecallTurn(opts.chat.commonplaceRecallHistory, head)
      if (signature) next = appendRetroSignature(next, signature)
      await getRepositories().chats.update(opts.chat.id, { commonplaceRecallHistory: next } as never)
    } catch (error) {
      logger.warn('[Recall] Failed to persist the anti-repetition ring', {
        chatId: opts.chat.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const counts = (Object.entries(delivered) as Array<[RecallPool, string[]]>)
    .map(([pool, ids]) => `${pool} ${ids.length}`)
    .join(', ')
  const debugLog = [
    ...traceLines(bundle.trace),
    `${RECALL_DEBUG_PREFIX} deliver: ${counts || 'nothing'}${lost.length > 0 ? `; ${lost.length} cut by compression` : ''}`,
    `${RECALL_RING_PREFIX} ${head.join(' ')}`.trimEnd(),
  ]
  logger.debug('[Recall] Delivered', {
    chatId: opts.chat.id,
    characterId: opts.characterId,
    delivered: Object.fromEntries(Object.entries(delivered).map(([k, v]) => [k, v.length])),
    lost: lost.length,
  })
  return { delivered, lost, debugLog }
}

/** The head ids a debug record says were delivered, or null when it has no ring line. */
export function ringFromDebugLog(lines: readonly string[] | null | undefined): string[] | null {
  const line = (lines ?? []).find(l => l.startsWith(RECALL_RING_PREFIX))
  if (line === undefined) return null
  return line.slice(RECALL_RING_PREFIX.length).trim().split(/\s+/).filter(id => id.length > 0)
}

/**
 * A message's debug log with a new set of non-recall lines (an extraction
 * job's), keeping the recall record the turn wrote.
 */
export function withRecallLines(existing: readonly string[] | null | undefined, lines: readonly string[]): string[] {
  const recall = (existing ?? []).filter(l => l.startsWith(RECALL_DEBUG_PREFIX) || l.startsWith(RECALL_RING_PREFIX))
  return [...recall, ...lines]
}
