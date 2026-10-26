/**
 * Snapshot-whisper sweep.
 *
 * Several Staff whispers are snapshots, not records: the Commonplace Book's
 * per-turn whisper, Aurora's Core whisper, the fold-posted relevant-conversations
 * list. Once a fresher one lands for a recipient, the recipient's earlier ones
 * of the same kind are stale, and the writer removes them — *after* the fresh
 * one is durably posted, so a failed post can never leave the recipient with
 * none at all.
 *
 * The recipient is a whisper scope (`isInWhisperScope`): the participant the
 * whisper was addressed to, or `null` for an untargeted one. A sweep is
 * best-effort — a stale whisper left standing is untidy, a thrown turn is not —
 * so failures are logged and swallowed.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import { isInWhisperScope } from '@/lib/schemas/chat.types'
import type { ChatEvent, MessageEvent } from '@/lib/schemas/types'

export interface SweepPriorWhispersParams {
  chatId: string
  /** The whisper just posted; never swept. */
  keepId: string
  /** The scope it was posted to — participant id, or null for untargeted. */
  targetParticipantId: string | null
  /** Which whispers count as the same kind as the one kept. */
  isSameKind: (message: MessageEvent) => boolean
  /**
   * The transcript to search. Pass one already read this turn — every prior
   * whisper is in it — rather than decoding the whole chat again; omitted, the
   * chat is read fresh.
   */
  events?: ReadonlyArray<ChatEvent>
  /** Log prefix of the writer doing the sweeping, e.g. `[CoreWhisper]`. */
  logTag: string
}

/**
 * Delete every whisper of the kept one's kind in its scope, except the kept
 * one. Returns how many were removed (0 on failure).
 */
export async function sweepPriorWhispers(params: SweepPriorWhispersParams): Promise<number> {
  const { chatId, keepId, targetParticipantId, isSameKind, logTag } = params
  try {
    const repos = getRepositories()
    const events = params.events ?? (await repos.chats.getMessages(chatId))
    const stale = events
      .filter((m): m is MessageEvent => m.type === 'message')
      .filter(m => m.id !== keepId && isSameKind(m) && isInWhisperScope(m, targetParticipantId))
      .map(m => m.id)
    if (stale.length === 0) return 0

    const removed = await repos.chats.deleteMessagesByIds(chatId, stale)
    logger.info(`${logTag} Swept stale whispers`, {
      chatId,
      messageId: keepId,
      targetParticipantId,
      deletedCount: removed,
    })
    return removed
  } catch (error) {
    logger.warn(`${logTag} Failed to sweep stale whispers`, {
      chatId,
      targetParticipantId,
      error: getErrorMessage(error),
    })
    return 0
  }
}
