/**
 * The turn's transcript snapshot.
 *
 * Several readers in one context build want the chat's stored events: the
 * EVERY_N_MINUTES timestamp gate, the fold-whisper dedup of the conversation
 * lists, Aurora's Core-whisper cadence, the progressions cadence, the snapshot
 * whisper sweeps and the referent ledger. Each used to read the chat for
 * itself — up to six full decodes of a compressed transcript per turn. They
 * now share one read, made the first time any of them asks (a turn that needs
 * none pays nothing).
 *
 * The snapshot does not include the Staff whispers this build posts. None of
 * its readers want them: the gates and cadences look at what came before the
 * turn, a sweep looks for the recipient's *prior* whispers (the one just
 * posted is kept by id anyway), and the referent ledger reads spoken lines
 * only (`spokenText` drops every Staff message).
 */

import { getRepositories } from '@/lib/repositories/factory'
import { lazyAsync } from '@/lib/utils/lazy-async'
import type { ChatEvent } from '@/lib/schemas/types'

export interface TurnTranscript {
  /** The chat's events as they stood when first asked for; read at most once. */
  events: () => Promise<ChatEvent[]>
}

export function createTurnTranscript(chatId: string): TurnTranscript {
  return { events: lazyAsync(() => getRepositories().chats.getMessages(chatId)) }
}

/**
 * Minutes since the most recent Host timestamp announcement, or null when the
 * chat has none — which `shouldInjectTimestamp` reads as "announce now".
 */
export function minutesSinceLastHostTimestamp(
  events: ReadonlyArray<ChatEvent>,
  nowMs: number,
): number | null {
  let mostRecent: number | null = null
  for (const m of events) {
    if (m.type !== 'message') continue
    if (m.systemSender !== 'host' || m.systemKind !== 'timestamp' || !m.createdAt) continue
    const t = new Date(m.createdAt).getTime()
    if (Number.isFinite(t) && (mostRecent === null || t > mostRecent)) mostRecent = t
  }
  return mostRecent === null ? null : (nowMs - mostRecent) / 60_000
}
