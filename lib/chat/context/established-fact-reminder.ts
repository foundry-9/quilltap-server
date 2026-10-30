/**
 * The established-fact reminder — a trailing section that repeats, once, every
 * established fact posted since this seat last spoke.
 *
 * The facts are already in the history the seat reads, framed in place
 * (`buildMessageContext`). This section is the "since you last spoke" nudge:
 * the last thing the model reads before it answers, under one vouching header
 * (`ESTABLISHED_FACT_REMINDER_HEADER`), so a fact posted three lines up is not
 * outvoted by an older memory recalled in the same prompt.
 *
 * - **Select:** every fact row (both kinds, public or addressed to this seat)
 *   newer than the seat's last own turn (`findLastOwnTurnMs`). With no prior
 *   own turn: every fact since the seat joined, or since the start for a seat
 *   with history access.
 * - **Format:** posting order; a seat line is prefixed with its speaker's name,
 *   a machine fact is not. Bodies verbatim.
 * - **Cap:** `ESTABLISHED_FACT_REMINDER_CAP` characters, oldest dropped first.
 *   Dropped facts stay in history.
 * - **Empty-is-absent:** no facts, no section — a turn without facts is
 *   byte-identical to one built before this feature existed.
 * - **Never writes.** Nothing is stored or consumed; the cadence is derived
 *   from history, as progressions' is.
 * - **Swipes:** with `regenerationOfMessageIds`, the history is cut at the
 *   first re-rolled row, so "last own turn" is measured on what the original
 *   generation saw and the re-roll gets the same reminder.
 *
 * The wording lives in `lib/chat/established-fact.ts`, as does the predicate.
 *
 * @module lib/chat/context/established-fact-reminder
 */

import { logger } from '@/lib/logger'
import {
  ESTABLISHED_FACT_REMINDER_HEADER,
  establishedFactKindOf,
} from '@/lib/chat/established-fact'
import { speakerLabel, type SpeakerNames } from '@/lib/chat/speaker-names'
import { findLastOwnTurnMs } from './core-whisper-trigger'
import type { ChatEvent, MessageEvent } from '@/lib/schemas/types'

/** The reminder never grows past this many characters; oldest facts go first. */
export const ESTABLISHED_FACT_REMINDER_CAP = 8000

export interface BuildEstablishedFactReminderInput {
  events: ReadonlyArray<ChatEvent>
  /** The responding seat (a chat participant id). */
  respondingParticipantId: string
  /** The seat's join time (`participant.createdAt`); ignored with history access. */
  joinedAt?: string | null
  hasHistoryAccess?: boolean
  /** Swipe re-apply: the message being re-rolled plus its whole swipe group. */
  regenerationOfMessageIds?: string[]
  /** Loaded lazily — only when there is a seat line to label. */
  loadSpeakerNames: () => Promise<SpeakerNames>
  chatId?: string
}

function msOf(value: unknown): number {
  return value instanceof Date ? value.getTime() : Date.parse(String(value))
}

/** The reminder section, or '' when there is nothing to remind. */
export async function buildEstablishedFactReminder(input: BuildEstablishedFactReminderInput): Promise<string> {
  const isSwipe = (input.regenerationOfMessageIds?.length ?? 0) > 0
  let events = input.events
  if (isSwipe) {
    const regen = new Set(input.regenerationOfMessageIds)
    const cut = events.findIndex(e => e.type === 'message' && regen.has((e as MessageEvent).id))
    if (cut >= 0) events = events.slice(0, cut)
  }

  const lastOwnMs = findLastOwnTurnMs(events as ChatEvent[], input.respondingParticipantId)
  const floorMs = lastOwnMs
    ?? (input.hasHistoryAccess || !input.joinedAt ? null : msOf(input.joinedAt))

  const facts: MessageEvent[] = []
  for (const e of events) {
    if (e.type !== 'message') continue
    const m = e as MessageEvent
    if (!establishedFactKindOf(m)) continue
    const targets = m.targetParticipantIds
    if (targets && targets.length > 0 && !targets.includes(input.respondingParticipantId)) continue
    if (floorMs !== null) {
      const ms = msOf(m.createdAt)
      if (!Number.isFinite(ms) || ms <= floorMs) continue
    }
    facts.push(m)
  }
  if (facts.length === 0) return ''

  const hasSeatLine = facts.some(m => establishedFactKindOf(m) === 'seat')
  const names = hasSeatLine ? await input.loadSpeakerNames() : new Map<string, string>()
  const items = facts.map(m =>
    establishedFactKindOf(m) === 'seat' ? `${speakerLabel(m, names)}: ${m.content}` : m.content,
  )

  // Cap: drop the oldest until the section fits. The newest fact always rides.
  let kept = items
  let length = ESTABLISHED_FACT_REMINDER_HEADER.length + kept.reduce((n, item) => n + item.length + 2, 0)
  while (kept.length > 1 && length > ESTABLISHED_FACT_REMINDER_CAP) {
    length -= kept[0].length + 2
    kept = kept.slice(1)
  }
  const dropped = items.length - kept.length

  logger.debug('[EstablishedFact] Built the since-you-last-spoke reminder', {
    chatId: input.chatId,
    participantId: input.respondingParticipantId,
    selected: facts.length,
    droppedByCap: dropped,
    isSwipe,
  })

  return [ESTABLISHED_FACT_REMINDER_HEADER, ...kept].join('\n\n')
}
