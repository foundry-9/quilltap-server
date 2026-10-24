/**
 * The trailing referent ledger and the closing echo of the user's line.
 *
 * A short line like "When she's not scolding Vergil" leans on a pronoun whose
 * antecedent sits in the *previous* turn ("…Abigail will absolutely make that a
 * formal finding. You've seen how she documents."). By the time the model reads
 * it, a Host card, the scene state and twenty-odd kilobytes of recall stand
 * between the two, and a weaker model resolves "she" to the nearest woman it
 * can see — itself. Two trailing sections answer that:
 *
 * - **The ledger** ({@link buildReferentLedger}) lists the people named in the
 *   last few spoken lines, most recent first, with their pronouns, whether they
 *   are in the room, who last named them and the sentence they were named in.
 *   Anyone listed who is not in the room brings their card — name, aliases,
 *   pronouns and identity — which is the only place the model now meets it:
 *   the Host's "spoken of" introduction in the Salon is record-only.
 *   Deterministic: a name/alias scan, no LLM call. The responder ("you") and
 *   the author of the latest line ("I") are left out — they are not who a
 *   third-person pronoun in that line points at.
 * - **The echo** ({@link buildClosingEcho}) repeats the line being answered at
 *   the very end of the trailing sections, after recall has had its say, so the
 *   last thing the model reads is what it is replying to.
 *
 * ## Where they land
 *
 * Trailing per-turn sections on the uncached tail, assembled by
 * `context-manager.ts` after the inform block and before the turn notes. Never
 * in system block 1, never persisted, so neither builder version moves.
 *
 * ## Empty is byte-for-byte nothing
 *
 * With nobody named in the window the ledger returns `''`; with no new user
 * message the echo returns `''`. The caller pushes nothing.
 */

import { logger } from '@/lib/logger'
import { buildNameMatcher, lastNameMatch } from '@/lib/chat/name-mentions'

const CONTEXT = 'chat.context.referent-ledger'

/** How many spoken lines (user and character, no Staff) the ledger scans. */
export const REFERENT_LEDGER_WINDOW_LINES = 6

/** At most this many people are listed; the most recently named win. */
export const REFERENT_LEDGER_MAX_PEOPLE = 8

/** The quoted sentence is trimmed to about this many characters around the name. */
export const REFERENT_LEDGER_QUOTE_CHARS = 220

/** A user line longer than this is echoed by its closing paragraphs only. */
export const CLOSING_ECHO_MAX_CHARS = 1500

/** One spoken line in the window, oldest first. */
export interface ReferentLedgerLine {
  /** Display name of who said it. */
  speaker: string
  /** True when the responding character said it. */
  isResponder: boolean
  content: string
}

/** A person the ledger may name. */
export interface ReferentLedgerPerson {
  id: string
  name: string
  aliases?: ReadonlyArray<string> | null
  pronouns?: { subject: string; object: string; possessive: string } | null
  /** Seated (not removed) in this chat. */
  inRoom: boolean
  /**
   * The person's particulars (the Host's off-scene card), rendered only if
   * they are listed. Given for people not in the room.
   */
  renderCard?: () => string
}

export interface BuildReferentLedgerInput {
  /** The last spoken lines, oldest first; the final one is the line being answered. */
  lines: ReadonlyArray<ReferentLedgerLine>
  /** Everyone who may be named, the responder included (it is filtered out). */
  people: ReadonlyArray<ReferentLedgerPerson>
  /** The responding character's id. */
  responderId: string
}

interface Mention {
  person: ReferentLedgerPerson
  lineIndex: number
  offset: number
  length: number
}

/** The sentence around `offset`, whitespace-collapsed and trimmed to the quote budget. */
function sentenceAround(content: string, offset: number, length: number): string {
  const boundary = /[.!?…]["'”’*_)]*\s+|\n+/g
  let start = 0
  let end = content.length
  let match: RegExpExecArray | null
  while ((match = boundary.exec(content)) !== null) {
    const after = match.index + match[0].length
    if (after <= offset) {
      start = after
    } else if (match.index >= offset + length) {
      end = match.index + match[0].trimEnd().length
      // Carry on into the next sentence when it fits: a name is so often
      // followed by the pronoun that stands for it ("…Abigail will make it a
      // formal finding. You've seen how she documents.").
      const next = boundary.exec(content)
      const nextEnd = next ? next.index + next[0].trimEnd().length : content.length
      if (nextEnd > end && nextEnd - start <= REFERENT_LEDGER_QUOTE_CHARS) end = nextEnd
      break
    }
  }
  let sentence = content.slice(start, end).replace(/\s+/g, ' ').trim()
  if (sentence.length > REFERENT_LEDGER_QUOTE_CHARS) {
    const local = offset - start
    const half = Math.floor(REFERENT_LEDGER_QUOTE_CHARS / 2)
    const from = Math.max(0, Math.min(local - half, sentence.length - REFERENT_LEDGER_QUOTE_CHARS))
    const to = Math.min(sentence.length, from + REFERENT_LEDGER_QUOTE_CHARS)
    sentence = `${from > 0 ? '…' : ''}${sentence.slice(from, to).trim()}${to < sentence.length ? '…' : ''}`
  }
  return sentence
}

const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

function whereNamed(lineIndex: number, lines: ReadonlyArray<ReferentLedgerLine>): string {
  const line = lines[lineIndex]
  const back = lines.length - 1 - lineIndex
  const by = line.isResponder ? 'by you' : `by ${line.speaker}`
  if (back === 0) return `${by}, in the line you are answering`
  if (line.isResponder) {
    const laterOwn = lines.slice(lineIndex + 1).some(l => l.isResponder)
    if (!laterOwn) return `${by}, in your last turn`
  }
  const count = NUMBER_WORDS[back] ?? String(back)
  return `${by}, ${count} line${back === 1 ? '' : 's'} back`
}

/**
 * The ledger section, or `''` when nobody but the responder and the latest
 * line's author is named in the window.
 */
export function buildReferentLedger(input: BuildReferentLedgerInput): string {
  const lines = input.lines.slice(-REFERENT_LEDGER_WINDOW_LINES)
  if (lines.length === 0) return ''

  const latestSpeaker = lines[lines.length - 1].speaker.trim().toLowerCase()
  const candidates = input.people.filter(
    p => p.id !== input.responderId && p.name.trim().toLowerCase() !== latestSpeaker,
  )

  const latest = new Map<string, Mention>()
  for (const person of candidates) {
    const matcher = buildNameMatcher([person.name, ...(person.aliases ?? [])])
    if (!matcher) continue
    for (let i = lines.length - 1; i >= 0 && !latest.has(person.id); i--) {
      const last = lastNameMatch(lines[i].content, matcher)
      if (last) {
        latest.set(person.id, { person, lineIndex: i, offset: last.index, length: last.text.length })
      }
    }
  }

  if (latest.size === 0) return ''

  const ordered = Array.from(latest.values())
    .sort((a, b) => b.lineIndex - a.lineIndex || b.offset - a.offset)
    .slice(0, REFERENT_LEDGER_MAX_PEOPLE)

  const entries = ordered.map(({ person, lineIndex, offset, length }) => {
    const pronouns = person.pronouns
      ? `${person.pronouns.subject}/${person.pronouns.object}`
      : 'pronouns not recorded'
    const room = person.inRoom ? 'in the room' : 'not in the room'
    const quote = sentenceAround(lines[lineIndex].content, offset, length)
    return `- **${person.name}** (${pronouns}; ${room}) — last named ${whereNamed(lineIndex, lines)}: “${quote}”`
  })

  const cards = ordered
    .filter(m => !m.person.inRoom && m.person.renderCard)
    .map(m => m.person.renderCard!())
    // A card with nothing under its heading tells the model nothing.
    .filter(card => card.trim().includes('\n'))

  logger.debug('[ReferentLedger] Ledger built', {
    context: CONTEXT,
    windowLines: lines.length,
    candidates: candidates.length,
    listed: ordered.map(m => m.person.name),
    cards: cards.length,
  })

  const section = [
    '## Who is being spoken of',
    '',
    'The people named in the last few lines, most recently named first. When a he, she, they, him or her in the line you are answering does not point at someone in that same line, it most likely carries on from the most recently named of these whose pronouns fit — read it from what was just said, not from who is nearest in your memories.',
    '',
    ...entries,
  ]
  if (cards.length > 0) {
    section.push(
      '',
      'Particulars of those not in the room — for accurate reference only. They are not present, cannot hear what is said here, and are not summoned by being named.',
      '',
      cards.join('\n\n'),
    )
  }
  return section.join('\n')
}

export interface BuildClosingEchoInput {
  /** The new user message, raw. Absent on chained / continue turns. */
  newUserMessage?: string | null
  /** Who wrote it. */
  speakerName: string
}

/**
 * The closing echo: the line being answered, repeated last. Long lines are
 * echoed by their closing paragraphs, which is where a dangling pronoun lives.
 */
export function buildClosingEcho(input: BuildClosingEchoInput): string {
  const text = input.newUserMessage?.trim()
  if (!text) return ''

  let body = text
  let partial = false
  if (text.length > CLOSING_ECHO_MAX_CHARS) {
    const paragraphs = text.split(/\n\s*\n/)
    const kept: string[] = []
    let used = 0
    for (let i = paragraphs.length - 1; i >= 0; i--) {
      const p = paragraphs[i].trim()
      if (!p) continue
      if (kept.length > 0 && used + p.length > CLOSING_ECHO_MAX_CHARS) break
      kept.unshift(p.length > CLOSING_ECHO_MAX_CHARS ? `…${p.slice(-CLOSING_ECHO_MAX_CHARS).trimStart()}` : p)
      used += p.length
    }
    body = kept.join('\n\n')
    partial = true
  }

  logger.debug('[ReferentLedger] Closing echo built', {
    context: CONTEXT,
    length: text.length,
    partial,
  })

  const quoted = body.split('\n').map(l => (l ? `> ${l}` : '>')).join('\n')
  const lead = partial
    ? `## The line you are answering\n\nThe closing part of what ${input.speakerName} just said, which is what you are replying to:`
    : `## The line you are answering\n\nWhat ${input.speakerName} just said, which is what you are replying to:`
  return `${lead}\n\n${quoted}`
}
