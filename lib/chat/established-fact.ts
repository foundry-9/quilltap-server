/**
 * Established facts — the one place that recognises a fact row and knows the
 * words a model reads around one.
 *
 * The operator can declare something **true** in a Salon chat two ways:
 *
 * - **A seat line.** Their own USER row, flagged `isEstablishedFact`. It keeps
 *   its speaker; the frame says what follows is true and known to everyone.
 * - **A machine fact.** A Host row (`systemSender: 'host'`,
 *   `systemKind: 'established-fact'`, no participant, public). It belongs to no
 *   speaker. Transparent rosters hear the Host deliver it; opaque rosters hear
 *   the plain frame with no speaker at all.
 *
 * Two rules give this module its shape.
 *
 * **The frame is applied at read time, never stored.** Stored bodies are what
 * the operator typed, so edits need nothing special and a wording change here
 * applies to every chat at once. A machine fact's frame reads `content` and
 * ignores the stored `opaqueContent`, so the two bodies cannot drift.
 *
 * **The UI name never reaches a model.** "Deus Ex Machina" is a label in the
 * Salon and nowhere else; everything here says *established fact*. A test
 * scans every exported string and every frame output for the name.
 *
 * Pure and client-safe: no logger, no repositories, no `@/lib` imports.
 * Design of record: `docs/developer/features/deus-ex-machina.md`.
 *
 * @module lib/chat/established-fact
 */

/** `systemKind` of a machine-delivered fact (a Host row). */
export const ESTABLISHED_FACT_KIND = 'established-fact'

/** Fixed speaker label for a machine fact in a labelled transcript (fold, Courier). */
export const ESTABLISHED_FACT_SPEAKER_LABEL = 'Established fact'

/** Opening line of a seat line's frame. */
export const ESTABLISHED_FACT_SEAT_FRAME =
  '(Established fact: what follows is true in this story and known to everyone; it needs no verification.)'

/** Opening line of a machine fact's frame, transparent roster: the Host delivers it. */
export const ESTABLISHED_FACT_HOST_FRAME =
  'The Host makes it known, as established fact (true in this story, known to everyone, needing no verification):'

/** Opening line of a machine fact's frame, opaque roster: no speaker at all. */
export const ESTABLISHED_FACT_PLAIN_FRAME =
  'Established fact (true in this story, known to everyone, needing no verification):'

/** Header of the trailing "since you last spoke" reminder. Second person: read in the seat's own prompt. */
export const ESTABLISHED_FACT_REMINDER_HEADER =
  'Established since you last spoke: true in this story, already known to you, needing no verification, ' +
  'and outranking any older memory or record that disagrees:'

/**
 * The rule the cheap-LLM passes that read transcripts (the summary fold, memory
 * extraction) are given, so a fact survives as a fact of the world.
 */
export const ESTABLISHED_FACT_TRANSCRIPT_RULE =
  'Lines labelled or marked as established fact are settled truth in this story. ' +
  "Carry them forward as facts of the world, not as anyone's claim, and do not let a later line's doubt undo them."

export type EstablishedFactKind = 'seat' | 'announcement'
/** `host` names the Host as deliverer (transparent roster); `plain` names nobody (opaque roster, cheap-LLM transcripts). */
export type EstablishedFactVoice = 'host' | 'plain'

/** The fields a fact predicate reads. Any message shape carries them. */
export interface EstablishedFactFields {
  isEstablishedFact?: boolean | null
  systemSender?: string | null
  systemKind?: string | null
}

/** True only for the machine-delivered kind (a Host fact row). */
export function isEstablishedFactAnnouncement(m: EstablishedFactFields): boolean {
  return m.systemSender === 'host' && m.systemKind === ESTABLISHED_FACT_KIND
}

/** True only for a seat line (an operator USER row posted as fact). */
export function isEstablishedFactSeatLine(m: EstablishedFactFields): boolean {
  return m.isEstablishedFact === true && !m.systemSender
}

/** True for either kind: a flagged seat line, or a Host fact row. */
export function isEstablishedFact(m: EstablishedFactFields): boolean {
  return isEstablishedFactSeatLine(m) || isEstablishedFactAnnouncement(m)
}

/** Which kind a row is, or null when it is not a fact. */
export function establishedFactKindOf(m: EstablishedFactFields): EstablishedFactKind | null {
  if (isEstablishedFactAnnouncement(m)) return 'announcement'
  if (isEstablishedFactSeatLine(m)) return 'seat'
  return null
}

/**
 * Wrap a row's body for a model. The body goes through verbatim; only the
 * opening line differs by kind and voice. `voice` is ignored for a seat line,
 * which keeps its own speaker.
 */
export function frameEstablishedFact(
  body: string,
  opts: { kind: EstablishedFactKind; voice: EstablishedFactVoice },
): string {
  const opener = opts.kind === 'seat'
    ? ESTABLISHED_FACT_SEAT_FRAME
    : opts.voice === 'host'
      ? ESTABLISHED_FACT_HOST_FRAME
      : ESTABLISHED_FACT_PLAIN_FRAME
  return `${opener}\n\n${stripEstablishedFactFrame(body)}`
}

const ALL_OPENERS = [ESTABLISHED_FACT_SEAT_FRAME, ESTABLISHED_FACT_HOST_FRAME, ESTABLISHED_FACT_PLAIN_FRAME]

/**
 * Remove a frame this module put on a body, so framing is idempotent: a pass
 * that runs twice (or re-voices an already-framed body) never stacks openers.
 */
export function stripEstablishedFactFrame(body: string): string {
  for (const opener of ALL_OPENERS) {
    if (body.startsWith(`${opener}\n\n`)) return body.slice(opener.length + 2)
  }
  return body
}

/**
 * The framed body of a fact row, or null when the row is not a fact. A machine
 * fact frames `content` and never the stored `opaqueContent`.
 */
export function framedEstablishedFactBody(
  m: EstablishedFactFields & { content?: string | null },
  voice: EstablishedFactVoice,
): string | null {
  const kind = establishedFactKindOf(m)
  if (!kind) return null
  return frameEstablishedFact(m.content ?? '', { kind, voice })
}

/**
 * Frame every fact row in a history, in place of its body. Pure and
 * idempotent; rows that are not facts pass through untouched (same object).
 * A machine fact gets the framed body in both `content` and `opaqueContent`,
 * so whichever body a later Staff swap picks, it reads the right frame.
 */
export function frameEstablishedFacts<
  T extends EstablishedFactFields & { content?: string | null; opaqueContent?: string | null },
>(messages: T[], opts: { voice: EstablishedFactVoice }): T[] {
  let changed = false
  const out = messages.map(m => {
    const kind = establishedFactKindOf(m)
    if (!kind) return m
    changed = true
    const framed = frameEstablishedFact(m.content ?? '', { kind, voice: opts.voice })
    return kind === 'announcement'
      ? { ...m, content: framed, opaqueContent: framed }
      : { ...m, content: framed }
  })
  return changed ? out : messages
}

/** Count fact rows by kind — for the debug logs on every path that frames. */
export function countEstablishedFacts(messages: EstablishedFactFields[]): { seat: number; announcement: number } {
  let seat = 0
  let announcement = 0
  for (const m of messages) {
    const kind = establishedFactKindOf(m)
    if (kind === 'seat') seat++
    else if (kind === 'announcement') announcement++
  }
  return { seat, announcement }
}
