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
 */

import { normalizeContentBlockFormat, stripCharacterNamePrefix } from '@/lib/llm/response-normalizer'
import { matchesSentinelLine } from './skip-signal'

/** The literal sentinel a character emits to yield the floor. */
export const YIELD_SENTINEL = '[YIELD]'

/** `systemKind` stamped on the Host message that records a yield. */
export const TURN_YIELD_SYSTEM_KIND = 'turn-yield'

const YIELD_PHRASE = 'yield'

/** A bracketed `[YIELD]` opening a line that carries more prose after it. */
const LEADING_BRACKETED_YIELD = /^\s*[*_~"'`]*\[\s*yield\s*\][*_~"'`]*[.!?,;:]*\s*/i

export type DetectYieldResult =
  | { yielded: true; cleaned: string }
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
speak, say), but keep it short — the floor will be theirs. To carry on
instead, write your reply as normal and ignore this note entirely; do not
mention the raised hand unless you choose to acknowledge it in character.`
}
