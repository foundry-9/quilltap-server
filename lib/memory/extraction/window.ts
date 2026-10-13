/**
 * Transcript windows for the extraction passes (memory refactor §3.7).
 *
 * One renderer per window shape, one speaker map, one truncation rule:
 *
 *  - **Turn windows** (`self-turn`, `other-turn`) render a `TurnTranscript`
 *    (`buildTurnTranscript`) through {@link renderTurnContext}.
 *  - **Stretch windows** (`other-fold`, `episode-fold`) render a run of chat
 *    messages through {@link renderStretch}: speaker-labelled by the shared
 *    resolver (`lib/chat/speaker-names.ts`), dated, each message cut at
 *    {@link STRETCH_MESSAGE_CHAR_CAP} characters.
 *
 * And the fold rules both stretch passes share:
 *
 * - **Eligibility.** Only a spoken USER/ASSISTANT line from a seat, with text,
 *   is read. Staff whispers, tool rows and empty messages are not.
 * - **Cursor.** A pass reads the messages strictly after its own cursor
 *   through the end of the window it was handed, ordered by the chat's own
 *   message order (`foldPassRange`) — so a stretch an earlier run lost to a
 *   timeout is read before the window, never jumped. A cursor that names a
 *   message no longer in the chat is treated as absent.
 * - **Slicing.** A window wider than the pass's prompt bound is processed in
 *   consecutive slices, oldest first, and the cursor advances only past a
 *   slice that was read (bugs 206, 207). Nothing is marked covered unread.
 *
 * @module memory/extraction/window
 */

import type { MessageEvent } from '@/lib/schemas/types'
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript'
import { speakerLabel, type SpeakerNames } from '@/lib/chat/speaker-names'
import { formatNameWithPronouns } from '../format-utils'

// ============================================================================
// Window shapes
// ============================================================================

/** One message of a stretch, speaker-labelled and dated. */
export interface StretchMessage {
  speaker: string
  content: string
  createdAt: string | null
}

/** What a pass reads: one closed turn, or a stretch of conversation. */
export type TranscriptWindow =
  | {
      kind: 'turn'
      transcript: TurnTranscript
      /** The turn's wall clock: the newest stamped message, else now. */
      nowIso: string
    }
  | {
      kind: 'stretch'
      /** The eligible messages, chronological. */
      messages: MessageEvent[]
      rendered: StretchMessage[]
      /** The newest stamped message of the stretch (the clock the model is shown), else now. */
      nowIso: string
      /** The oldest stamped message of the stretch, else `nowIso`. */
      startIso: string
      /** The message the pass's cursor may advance to once this stretch is read. */
      coverThroughMessageId: string | null
    }

export type StretchWindow = Extract<TranscriptWindow, { kind: 'stretch' }>

/** One message is cut at this many characters inside a stretch. */
export const STRETCH_MESSAGE_CHAR_CAP = 1500

/** A stretch window over `messages` (already eligible), labelled with `speakerNames`. */
export function stretchWindow(
  messages: MessageEvent[],
  speakerNames: SpeakerNames,
  coverThroughMessageId: string | null,
  nowMs: number = Date.now(),
): StretchWindow {
  const lastStamped = [...messages].reverse().find(m => m.createdAt)
  const firstStamped = messages.find(m => m.createdAt)
  const nowIso = lastStamped?.createdAt ?? new Date(nowMs).toISOString()
  return {
    kind: 'stretch',
    messages,
    rendered: messages.map(m => ({
      speaker: speakerLabel(m, speakerNames),
      content: m.content ?? '',
      createdAt: m.createdAt ?? null,
    })),
    nowIso,
    startIso: firstStamped?.createdAt ?? nowIso,
    coverThroughMessageId,
  }
}

/** A turn window over a built transcript. */
export function turnWindow(transcript: TurnTranscript, nowMs: number = Date.now()): TranscriptWindow {
  return { kind: 'turn', transcript, nowIso: transcript.turnTimestamp ?? new Date(nowMs).toISOString() }
}

/** `[2026-07-14 09:30] Amy: …` — one line per message, the one stretch rendering. */
export function renderStretch(messages: ReadonlyArray<StretchMessage>): string {
  return messages
    .map(m => {
      const stamp = m.createdAt ? `[${m.createdAt.slice(0, 16).replace('T', ' ')}] ` : ''
      const content = m.content.length > STRETCH_MESSAGE_CHAR_CAP
        ? `${m.content.slice(0, STRETCH_MESSAGE_CHAR_CAP)}…`
        : m.content
      return `${stamp}${m.speaker}: ${content}`
    })
    .join('\n\n')
}

// ============================================================================
// Turn rendering
// ============================================================================

/** The transcript heading when the turn carries a human line (spec §8.2). */
export const ORDERED_TURN_TRANSCRIPT_HEADING =
  "TURN TRANSCRIPT (in the order spoken — the USER's lines came first; nothing the USER says here answers anything a character says below it):"

/**
 * Render the participant roster + joined transcript for inclusion in
 * extraction prompts. Single shared formatter so the user-pass, self-pass
 * and inter-character-pass all see byte-identical input prefixes.
 */
export function renderTurnContext(transcript: TurnTranscript): string {
  // A user-controlled character now arrives as a slice (built from the turn
  // opener). It is the human participant *and* a memory-forming character, so
  // we list it on the USER line and render its lines once in the body labeled
  // "(the user-controlled character)" — never under the AI-character roster and
  // never duplicated as a standalone opener. AI slices keep their existing
  // labeling, so a turn with no user-controlled slice renders byte-identically
  // to before.
  const aiSlices = transcript.characterSlices.filter(s => !s.isUserControlled)
  const userSlices = transcript.characterSlices.filter(s => s.isUserControlled)
  const hasUserSlice = userSlices.length > 0

  const roster: string[] = ['PARTICIPANTS IN THIS TURN:']
  const userDisplayName = transcript.userCharacterName ?? userSlices[0]?.characterName ?? null
  if (userDisplayName) {
    roster.push(`- USER: ${userDisplayName} (the human participant)`)
  } else if (transcript.userMessage !== null) {
    roster.push('- USER: The human participant')
  }

  if (aiSlices.length === 1) {
    const slice = aiSlices[0]
    roster.push(
      `- CHARACTER: ${formatNameWithPronouns(slice.characterName, slice.characterPronouns ?? null)} (an AI character)`
    )
  } else if (aiSlices.length > 1) {
    roster.push('- CHARACTERS (AI characters in this chat):')
    for (const slice of aiSlices) {
      roster.push(
        `  * ${formatNameWithPronouns(slice.characterName, slice.characterPronouns ?? null)}`
      )
    }
  }

  const transcriptSections: string[] = []
  // Render the standalone opener only when no user slice carries it — i.e. a
  // plain human with no character. When a user slice exists, its body line
  // below is the single rendering of that text.
  if (transcript.userMessage !== null && !hasUserSlice) {
    const userLabel = transcript.userCharacterName
      ? `${transcript.userCharacterName} (the user)`
      : 'The user'
    transcriptSections.push(`${userLabel} says:\n"${transcript.userMessage}"`)
  }
  for (const slice of transcript.characterSlices) {
    const role = slice.isUserControlled ? 'the user-controlled character' : 'the character'
    const characterLabel = `${formatNameWithPronouns(slice.characterName, slice.characterPronouns ?? null)} (${role})`
    transcriptSections.push(`${characterLabel} says:\n"${slice.text}"`)
  }

  // By construction the human's line opens the turn and the next human line
  // is not in it, so nothing the human says here answers a character below.
  // Saying so is what keeps the extractor from manufacturing assent. A turn
  // with no human line keeps the plain heading, byte-identical to before.
  const heading = transcript.userMessage !== null || hasUserSlice
    ? ORDERED_TURN_TRANSCRIPT_HEADING
    : 'TURN TRANSCRIPT:'

  return `${roster.join('\n')}

${heading}

${transcriptSections.join('\n\n')}`
}

// ============================================================================
// Fold rules
// ============================================================================

/** A message that carries conversation: a spoken USER/ASSISTANT line from a seat, not staff or tool output. */
export function isFoldEligibleMessage(m: MessageEvent): boolean {
  if (m.type !== 'message') return false
  if (m.role !== 'USER' && m.role !== 'ASSISTANT') return false
  if (m.systemSender) return false
  if (!m.participantId) return false
  return typeof m.content === 'string' && m.content.trim().length > 0
}

/**
 * Messages strictly after the cursor. A cursor that names a message no
 * longer in the chat (deleted) is treated as absent — better to re-read the
 * tail once than to go blind forever.
 */
export function messagesPastCursor<T extends { id: string }>(
  allMessages: ReadonlyArray<T>,
  cursorMessageId: string | null | undefined,
): T[] {
  if (!cursorMessageId) return [...allMessages]
  const idx = allMessages.findIndex(m => m.id === cursorMessageId)
  if (idx === -1) return [...allMessages]
  return allMessages.slice(idx + 1)
}

/**
 * Cut a window (any subset of the chat's messages) to what lies strictly after
 * the cursor, using `allMessages` (the chat's messages, chronological) for
 * order. Returns the window unchanged when there is no cursor or the
 * cursor names a message the chat no longer has.
 */
export function windowPastCursor<T extends { id: string }>(
  window: ReadonlyArray<T>,
  allMessages: ReadonlyArray<{ id: string }>,
  cursorMessageId: string | null | undefined,
): { window: T[]; applied: boolean } {
  if (!cursorMessageId) return { window: [...window], applied: false }
  const cursorIdx = allMessages.findIndex(m => m.id === cursorMessageId)
  if (cursorIdx === -1) return { window: [...window], applied: false }
  const order = new Map(allMessages.map((m, i) => [m.id, i]))
  return {
    window: window.filter(m => (order.get(m.id) ?? Infinity) > cursorIdx),
    applied: true,
  }
}

/** One slice of a fold window, and the message the cursor may advance to once it is read. */
export interface FoldWindowSlice<T> {
  messages: T[]
  coverThroughMessageId: string | null
}

/**
 * Split eligible messages into consecutive slices of at most `maxPerSlice`,
 * oldest first. Every slice but the last covers through its own last message;
 * the last covers through `finalCoverThroughId` (the end of the untrimmed
 * window, which may be an ineligible row) when given. Messages between two
 * slices are ineligible by construction, so covering through a slice's last
 * eligible message skips nothing a pass would have read.
 */
export function sliceFoldWindow<T extends { id: string }>(
  eligible: ReadonlyArray<T>,
  maxPerSlice: number,
  finalCoverThroughId: string | null,
): Array<FoldWindowSlice<T>> {
  const size = Math.max(1, Math.floor(maxPerSlice))
  const slices: Array<FoldWindowSlice<T>> = []
  for (let start = 0; start < eligible.length; start += size) {
    const messages = eligible.slice(start, start + size)
    const isLast = start + size >= eligible.length
    slices.push({
      messages,
      coverThroughMessageId: isLast
        ? (finalCoverThroughId ?? messages[messages.length - 1]?.id ?? null)
        : (messages[messages.length - 1]?.id ?? null),
    })
  }
  return slices
}

/** What a fold pass should read this run: everything past its cursor through the end of the window it was handed. */
export interface FoldPassRange<T> {
  messages: T[]
  /** True when the cursor shaped the range (it named a message still in the chat). */
  applied: boolean
  /** Messages in the range that were not in the window handed over — an unread stretch the pass is catching up on. */
  gap: number
}

/**
 * The stretch a fold-grain pass reads: the messages strictly after its
 * cursor, through the last message of the window it was handed, in the
 * chat's own order. A pass never reads only the window, because the window is
 * the *fold's* — a slice the pass lost to a timeout lies before it, and reading
 * the window alone would carry the cursor over that slice for good. Without
 * a cursor (or with one naming a vanished message) the window is the range,
 * as before: a pass that has never run does not backfill all history on the
 * fold path.
 */
export function foldPassRange<T extends { id: string }>(
  window: ReadonlyArray<T>,
  allMessages: ReadonlyArray<T>,
  cursorMessageId: string | null | undefined,
): FoldPassRange<T> {
  if (window.length === 0 || !cursorMessageId) return { messages: [...window], applied: false, gap: 0 }
  const cursorIdx = allMessages.findIndex(m => m.id === cursorMessageId)
  if (cursorIdx === -1) return { messages: [...window], applied: false, gap: 0 }
  const lastId = window[window.length - 1].id
  const endIdx = allMessages.findIndex(m => m.id === lastId)
  if (endIdx === -1) {
    // The window's end is not in the transcript we were given; fall back to cutting the window itself.
    const cut = windowPastCursor(window, allMessages, cursorMessageId)
    return { messages: cut.window, applied: cut.applied, gap: 0 }
  }
  if (endIdx <= cursorIdx) return { messages: [], applied: true, gap: 0 }
  const messages = allMessages.slice(cursorIdx + 1, endIdx + 1)
  const inWindow = new Set(window.map(m => m.id))
  const gap = messages.reduce((n, m) => (inWindow.has(m.id) ? n : n + 1), 0)
  return { messages, applied: true, gap }
}
