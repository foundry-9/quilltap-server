/**
 * Raised-hand yielding — shared pure logic.
 *
 * When the operator raises a hand (the composer's soft-interrupt button), the
 * next character to take the floor finds a Turn note in its prompt asking
 * whether it will yield. It answers with the `[YIELD]` sentinel, or simply
 * takes its turn. A yield is recorded as a Host message
 * (`systemSender: 'host'`, `systemKind: 'turn-yield'`,
 * `hostEvent: { participantId }`) and the chain stops so the floor is the
 * operator's; the chat is not paused. Who has a hand up lives in
 * `lib/chat/turn-control.ts` (server-only); this module is client-safe.
 *
 * Detection is deliberately forgiving in the same ways as the turn-pass
 * sentinel (`skip-signal.ts`): wrapping markdown, optional brackets, case and
 * trailing punctuation are shed, a leading own-name prefix is stripped, and a
 * sentinel on the LAST line counts as well as the first (weaker models narrate
 * a gesture and then tack the sentinel on). Any prose around the sentinel is
 * kept as the character's reply — "After you, my dear" and then the yield.
 *
 * One answer counts as a yield without the sentinel: a short reply that is
 * nothing but a single stage direction, with no word spoken aloud
 * (`*(a tilt of the head — go on, then)*`). Models asked to yield often hand
 * over the floor in a gesture and forget the sentinel; a character who was
 * offered the floor and said nothing has, in effect, yielded it. The Turn
 * note tells the model so, and the gesture is kept as its reply.
 */

import { normalizeContentBlockFormat, stripCharacterNamePrefix } from '@/lib/llm/response-normalizer'
import { matchesSentinelLine } from './skip-signal'

/** The literal sentinel a character emits to yield the floor. */
export const YIELD_SENTINEL = '[YIELD]'

/** `systemKind` stamped on the Host message that records a yield. */
export const TURN_YIELD_SYSTEM_KIND = 'turn-yield'

const YIELD_PHRASE = 'yield'

/** Longest reply read as a gesture-only yield; past this it is a scene beat. */
const GESTURE_ONLY_MAX_CHARS = 280

/** Quotation marks: any of them means a word was spoken. */
const SPOKEN_QUOTE = /["“”«»„]/

/** Stage-direction wrappers: opening character → closing character. */
const GESTURE_WRAPPERS: Record<string, string> = { '*': '*', '_': '_', '(': ')' }

/**
 * Is this reply nothing but one stage direction — wrapped whole in `*…*`,
 * `_…_` or `(…)` (layered as the model likes), on one paragraph, short, with
 * no quotation marks? A closing wrapper inside a layer means prose sits
 * between two directions (`*nods* Fine. *smiles*`), which is not a gesture.
 */
export function isGestureOnlyReply(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > GESTURE_ONLY_MAX_CHARS) return false
  if (/\n\s*\n/.test(trimmed) || SPOKEN_QUOTE.test(trimmed)) return false

  let s = trimmed
  let peeled = false
  for (;;) {
    const close = GESTURE_WRAPPERS[s[0]]
    if (!close || s.length < 2 || s[s.length - 1] !== close) break
    let run = 1
    if (close === s[0]) {
      // `**bold**`-style runs peel together.
      while (run < s.length / 2 && s[run] === s[0] && s[s.length - 1 - run] === close) run++
    }
    const inner = s.slice(run, s.length - run).trim()
    if (inner.includes(close)) return false
    s = inner
    peeled = true
  }
  return peeled && /[\p{L}]/u.test(s)
}

/** A bracketed `[YIELD]` opening a line that carries more prose after it. */
const LEADING_BRACKETED_YIELD = /^\s*[*_~"'`]*\[\s*yield\s*\][*_~"'`]*[.!?,;:]*\s*/i

export type DetectYieldResult =
  /** `inferred`: no sentinel; the reply was a gesture-only yield. */
  | { yielded: true; cleaned: string; inferred?: true }
  | { yielded: false }

/**
 * Decide whether a raw model response yields the floor.
 *
 * `cleaned` is the response with the sentinel removed (possibly empty): the
 * prose a yielding character also said, which the caller persists as an
 * ordinary reply when it is non-empty.
 */
export function detectYieldSentinel(
  response: string,
  characterName?: string,
  aliases?: string[],
): DetectYieldResult {
  if (!response) return { yielded: false }

  // As in `detectSkipSentinel`: only strip a name prefix when there is a name
  // to target, or the generic bracketed-name fallback eats `[YIELD]` itself.
  const normalizedRaw = normalizeContentBlockFormat(response)
  const normalized = (characterName || (aliases && aliases.length > 0))
    ? stripCharacterNamePrefix(normalizedRaw, characterName, aliases)
    : normalizedRaw

  const lines = normalized.split('\n')
  let firstIdx = -1
  let lastIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length === 0) continue
    if (firstIdx === -1) firstIdx = i
    lastIdx = i
  }
  if (firstIdx === -1) return { yielded: false }

  const without = (idx: number) =>
    [...lines.slice(0, idx), ...lines.slice(idx + 1)].join('\n').trim()

  if (matchesSentinelLine(lines[firstIdx], YIELD_PHRASE)) {
    return { yielded: true, cleaned: without(firstIdx) }
  }
  if (lastIdx !== firstIdx && matchesSentinelLine(lines[lastIdx], YIELD_PHRASE)) {
    return { yielded: true, cleaned: without(lastIdx) }
  }

  // `[YIELD] After you.` on one line: the bracketed form is unambiguous enough
  // to honour at the head of a line; a bare "yield" word inside prose is not.
  const leading = lines[firstIdx].match(LEADING_BRACKETED_YIELD)
  if (leading) {
    const rest = [
      ...lines.slice(0, firstIdx),
      lines[firstIdx].slice(leading[0].length),
      ...lines.slice(firstIdx + 1),
    ].join('\n').trim()
    return { yielded: true, cleaned: rest }
  }

  // No sentinel, but nothing spoken either: a gesture handing over the floor.
  if (isGestureOnlyReply(normalized)) {
    return { yielded: true, cleaned: normalized.trim(), inferred: true }
  }

  return { yielded: false }
}

/**
 * Build the ephemeral "the operator has raised a hand" Turn note. Never
 * persisted — it rides only in this one turn's outgoing context, so the
 * sentinel never sits in history to be learned. `operatorName` is the name the
 * room knows the operator by (their persona, or "the User").
 */
export function buildTurnYieldInstruction(operatorName: string): string {
  return `[Turn note from the Salon — not spoken by any character]
${operatorName} has raised a hand, wishing to interject before you take your turn.
You may yield the floor to them, or carry on as though you had not noticed.

To yield, reply with exactly this line:

${YIELD_SENTINEL}

You may follow it with a brief in-character line (a gesture inviting them to
speak, say), but keep it short — the floor will be theirs. A reply that is
only a gesture, with no words spoken aloud, is also taken as yielding.

To carry on instead, write your reply as normal and ignore this note entirely;
do not mention the raised hand unless you choose to acknowledge it in
character.`
}
