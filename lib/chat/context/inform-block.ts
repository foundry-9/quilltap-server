/**
 * The inform block — the one reader of `chat_informs` on the prompt path.
 *
 * An **inform** is an out-of-character passage the operator hands to a seat:
 * something the character now knows or notices, delivered verbatim as its own
 * system block immediately after the static system prefix on that seat's next
 * generation, and consumed once the turn produces a persisted assistant
 * message.
 *
 * Two rules give this module its whole shape.
 *
 * **It never frames the text.** The block is exactly what the operator typed —
 * no preamble, no "do not mention this", no Host voice, for transparent and
 * opaque characters alike. Several pending passages join with a `---` rule and
 * nothing else. Anything more would be the House speaking over the operator.
 *
 * **It never writes.** Selection and consumption are deliberately separate:
 * building a context is not evidence that anything was delivered, and a
 * provider failure that saves no message must leave the rows pending for the
 * seat's next attempt. `markConsumed` is called by the finalizer, against a
 * *persisted* assistant message id — never from here.
 *
 * A **standing** inform (`permanent: true`) is the exception to "consumed
 * once": it rides every generation the seat makes in this chat until the
 * operator withdraws it. Standing passages lead the block (they are the same
 * turn after turn, so the block's front stays stable for prefix caches), and
 * only a standing row that has never been delivered is handed back for
 * consumption — which stamps its first delivery without retiring it.
 *
 * A swipe is the one case that reads consumed rows. Re-rolling a past line has
 * to see exactly the informs that line's generation saw, so the caller passes
 * `regenerationOfMessageIds` (the target message plus every id in its swipe
 * group) and gets those rows back. Pending rows are deliberately NOT delivered
 * to a swipe — a swipe re-rolls a past line, and it would be surprising for a
 * brand-new inform to land there and vanish. Standing rows ARE delivered to a
 * swipe: they are in force for every prompt from now on, and a swipe is one.
 *
 * Nothing else reads `chat_informs` on the prompt path. Design of record:
 * `docs/developer/features/salon-inform.md`.
 *
 * @module lib/chat/context/inform-block
 */

import { logger } from '@/lib/logger'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ChatInform } from '@/lib/schemas/chat-inform.types'

/** The separator between stacked passages. Nothing else joins them. */
export const INFORM_BLOCK_SEPARATOR = '\n\n---\n\n'

export interface BuildInformBlockOptions {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  /** The responding seat — a chat PARTICIPANT id, never a character id. */
  participantId: string
  /**
   * Swipe re-apply: the message being re-rolled plus every id in its swipe
   * group. When given, the block carries the rows those generations consumed
   * plus every standing row now in force, and no pending one-shot row at all.
   */
  regenerationOfMessageIds?: string[]
}

export interface InformBlock {
  /** The assembled system block, or null when there is nothing to deliver. */
  content: string | null
  /**
   * The rows this block carried that the finalizer should consume: every
   * one-shot row, and any standing row not yet delivered. Empty on a swipe.
   */
  rowIds: string[]
}

const EMPTY: InformBlock = { content: null, rowIds: [] }

/**
 * Assemble the inform block for one generation.
 *
 * Returns `{ content: null, rowIds: [] }` when there is nothing to deliver —
 * and the caller must then push *nothing*, so a turn with no informs is
 * byte-for-byte identical to one built before this feature existed. That is
 * what keeps the cache-determinism golden and the provider prompt caches
 * intact.
 */
export async function buildInformBlock({
  repos,
  chatId,
  participantId,
  regenerationOfMessageIds,
}: BuildInformBlockOptions): Promise<InformBlock> {
  const isSwipe = Array.isArray(regenerationOfMessageIds) && regenerationOfMessageIds.length > 0

  const inForce = await repos.chatInforms.findPendingForParticipant(chatId, participantId)
  const rows = isSwipe
    ? mergeForSwipe(
        await repos.chatInforms.findConsumedByMessages(chatId, participantId, regenerationOfMessageIds!),
        inForce.filter(r => r.permanent),
      )
    : inForce

  if (rows.length === 0) {
    logger.debug('[Inform] No inform block for this turn', {
      chatId,
      participantId,
      pending: 0,
      reapplied: 0,
      standing: 0,
    })
    return EMPTY
  }

  const bodies = rows
    .map(r => r.contentMarkdown.trim())
    .filter(body => body.length > 0)

  if (bodies.length === 0) {
    return EMPTY
  }

  const standing = rows.filter(r => r.permanent).length

  logger.debug('[Inform] Built inform block', {
    chatId,
    participantId,
    pending: isSwipe ? 0 : rows.length - standing,
    reapplied: isSwipe ? rows.length - standing : 0,
    standing,
    passages: bodies.length,
  })

  return {
    content: bodies.join(INFORM_BLOCK_SEPARATOR),
    // A swipe never consumes: the caller ignores these, but returning an empty
    // list makes that impossible to get wrong by accident. Off a swipe, a
    // standing row already delivered is left out so its first-delivery stamp
    // never moves.
    rowIds: isSwipe ? [] : rows.filter(r => !r.consumedAt).map(r => r.id),
  }
}

/**
 * A swipe's rows: what the re-rolled generation consumed, plus every standing
 * row now in force, standing first and without duplicates (a standing row's
 * first delivery may have been the very message being swiped).
 */
function mergeForSwipe(
  reapplied: ChatInform[],
  standing: ChatInform[],
): ChatInform[] {
  const seen = new Set(standing.map(r => r.id))
  return [...standing, ...reapplied.filter(r => !seen.has(r.id))]
}
