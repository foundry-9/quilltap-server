/**
 * Whisper privacy, as the model reads it: the mark a whisper carries in
 * history, and the whisper-reply note.
 *
 * **The mark** (`frameIncomingWhispers`): a seat's whisper to the responder is
 * prefixed, in the responder's context only, with {@link WHISPER_MARK} — read
 * time, never stored — so a private line in history does not read like one
 * said to the room. The responder's own whispers are left unmarked (they sit
 * beside the `whisper` tool call that sent them, and a marked line of its own
 * would invite the model to write the mark into a public reply).
 *
 * **The note** (`buildWhisperReplyNote`) — a trailing section telling a seat
 * that what it is answering reached it as a whisper, and that its own reply is
 * spoken aloud.
 *
 * Without it a whisper arrives in history looking like any other line (the
 * visibility filter keeps it from the others, but nothing tells the recipient
 * it was private), and the model answers in its ordinary reply — which posts
 * publicly, in front of everyone in the room. That is how a character came to
 * narrate a private implant conversation at a stranger's kitchen table.
 *
 * - **Select:** every whisper from another seat (a seat line, not a Staff
 *   whisper: `participantId` set, no `systemSender`, `USER` / `ASSISTANT`
 *   role) addressed to this seat and newer than the seat's last own turn
 *   (`findLastOwnTurnMs`). Nothing since then, no note.
 * - **Format:** who whispered, who else is present and did not hear it, and
 *   the one rule: the reply is heard by everyone, so a private answer goes
 *   through the `whisper` tool, and the reply never narrates the private
 *   exchange. When the seat holds no `whisper` tool this turn (a swipe, the
 *   chat's tools turned off), it is told to keep the private matter out of
 *   its reply instead.
 * - **Empty-is-absent:** a turn with no whisper waiting is byte-identical to
 *   one built before this note existed.
 * - **Never writes.** The cadence is derived from history.
 * - **Swipes:** with `regenerationOfMessageIds`, history is cut at the first
 *   re-rolled row, so the re-roll sees the note the original saw.
 *
 * Model-facing, so plain; in the register of the other Turn notes.
 *
 * @module lib/chat/context/whisper-privacy
 */

import { logger } from '@/lib/logger'
import { isParticipantPresent } from '@/lib/schemas/chat.types'
import type { SpeakerNames } from '@/lib/chat/speaker-names'
import { findLastOwnTurnMs } from './core-whisper-trigger'
import type { ChatEvent, ChatParticipantBase, MessageEvent } from '@/lib/schemas/types'

export interface BuildWhisperReplyNoteInput {
  events: ReadonlyArray<ChatEvent>
  /** The responding seat (a chat participant id). */
  respondingParticipantId: string
  /** Every seat in the chat, to name who is present and did not hear. */
  allParticipants: ReadonlyArray<ChatParticipantBase>
  /** Whether this seat holds the `whisper` tool on this turn. */
  whisperToolOffered: boolean
  /** Swipe re-apply: the message being re-rolled plus its whole swipe group. */
  regenerationOfMessageIds?: string[]
  /** Loaded lazily — only when there is a whisper to name. */
  loadSpeakerNames: () => Promise<SpeakerNames>
  chatId?: string
}

function msOf(value: unknown): number {
  return value instanceof Date ? value.getTime() : Date.parse(String(value))
}

/** The fields the whisper predicate reads. */
type WhisperRow = {
  role?: string
  participantId?: string | null
  targetParticipantIds?: string[] | null
  systemSender?: string | null
}

/** A seat's whisper addressed to `participantId` — not a Staff whisper, not a tool row. */
export function isSeatWhisperTo(m: WhisperRow, participantId: string): boolean {
  if (m.systemSender) return false
  if (m.role !== 'USER' && m.role !== 'ASSISTANT') return false
  if (!m.participantId || m.participantId === participantId) return false
  const targets = m.targetParticipantIds
  return !!targets && targets.length > 0 && targets.includes(participantId)
}

/** Prefixed to a whisper the responder received, in its context only. */
export const WHISPER_MARK = '(whispered privately to you; no one else present heard this)'
/** The same, for a whisper addressed to the responder and others. */
export const WHISPER_MARK_SHARED = '(whispered privately to you and a few others; the rest of the room did not hear this)'

/**
 * Mark every seat whisper addressed to `respondingParticipantId` with
 * {@link WHISPER_MARK}. Rows that are not one pass through untouched (same
 * object), so a chat without whispers costs nothing.
 */
export function frameIncomingWhispers<T extends WhisperRow & { content?: string }>(
  rows: T[],
  respondingParticipantId: string,
): { rows: T[]; framed: number } {
  let framed = 0
  const out = rows.map(m => {
    if (!isSeatWhisperTo(m, respondingParticipantId) || !m.content) return m
    framed++
    const mark = (m.targetParticipantIds?.length ?? 0) > 1 ? WHISPER_MARK_SHARED : WHISPER_MARK
    return { ...m, content: `${mark} ${m.content}` }
  })
  return { rows: framed > 0 ? out : rows, framed }
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The note, or '' when no whisper has reached this seat since it last spoke. */
export async function buildWhisperReplyNote(input: BuildWhisperReplyNoteInput): Promise<string> {
  const isSwipe = (input.regenerationOfMessageIds?.length ?? 0) > 0
  let events = input.events
  if (isSwipe) {
    const regen = new Set(input.regenerationOfMessageIds)
    const cut = events.findIndex(e => e.type === 'message' && regen.has((e as MessageEvent).id))
    if (cut >= 0) events = events.slice(0, cut)
  }

  const responder = input.respondingParticipantId
  const lastOwnMs = findLastOwnTurnMs(events as ChatEvent[], responder)

  const whispers: MessageEvent[] = []
  for (const e of events) {
    if (e.type !== 'message') continue
    const m = e as MessageEvent
    if (!isSeatWhisperTo(m, responder)) continue
    if (lastOwnMs !== null) {
      const ms = msOf(m.createdAt)
      if (!Number.isFinite(ms) || ms <= lastOwnMs) continue
    }
    whispers.push(m)
  }
  if (whispers.length === 0) return ''

  const names = await input.loadSpeakerNames()
  const nameOf = (id: string) => names.get(id)

  const senderIds = [...new Set(whispers.map(m => m.participantId as string))]
  const senders = senderIds.map(nameOf).filter((n): n is string => !!n)
  const senderText = senders.length > 0 ? joinNames(senders) : 'Someone'

  // Who is in the room and was not party to any of these whispers.
  const inTheKnow = new Set<string>([responder, ...senderIds])
  for (const m of whispers) for (const t of m.targetParticipantIds ?? []) inTheKnow.add(t)
  const outsiders = input.allParticipants
    .filter(p => isParticipantPresent(p.status) && !inTheKnow.has(p.id))
    .map(p => nameOf(p.id))
    .filter((n): n is string => !!n)

  const whoDidNotHear = outsiders.length > 0
    ? `${joinNames(outsiders)} did not hear it, and must not learn it from you.`
    : 'No one else heard it.'

  const howToAnswer = input.whisperToolOffered
    ? `Your reply below is NOT private: everything in it is said and done in front of everyone present. To answer ${senderText} privately, call the \`whisper\` tool with your private words. Then, in your reply, show only what the others could see or hear: a glance, a pause, a carefully neutral remark, or nothing at all.`
    : `Your reply below is NOT private: everything in it is said and done in front of everyone present, and you have no private channel on this turn. Keep the private matter out of your reply entirely; show only what the others could see or hear.`

  const note = `[Turn note from the Salon — not spoken by any character]
${senderText} whispered to you privately${whispers.length > 1 ? ' since you last spoke' : ''}. ${whoDidNotHear}
${howToAnswer} Never write the private words, or a summary of them, into your reply — not as dialogue, not as narration, not as an aside.`

  logger.debug('[WhisperReply] Built the whisper-reply note', {
    chatId: input.chatId,
    participantId: responder,
    whispers: whispers.length,
    senders: senderIds.length,
    outsiders: outsiders.length,
    whisperToolOffered: input.whisperToolOffered,
    isSwipe,
  })

  return note
}
