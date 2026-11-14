/**
 * A character's public identity — what others know about them, in one place.
 *
 * The `identity` field (`identity.md` in the vault) is the author's prose for
 * "what strangers know". Some of that is already known precisely from other
 * fields, and should not depend on the prose keeping up:
 *
 *   1. **Age**, when the character has a birthday — calculated, so it is right
 *      on every day of every year (`lib/characters/birthday.ts`).
 *   2. **Public progressions** — the timed spans the author marked public, in
 *      fixed third-person wording (`renderPublicProgressionLine`).
 *   3. **Pronouns.**
 *
 * Those come first, in that order, and the author's identity text follows.
 * Every reader that reports a character's identity to someone else — the
 * Host's introduction, the off-scene card, Carina's asker card, the
 * self_inventory roster and Brahma's `lookup_character` — composes it here
 * rather than stitching fields together itself.
 *
 * ## Not in the cached prefix
 *
 * Age and progressions move with the wall clock. Nothing here may feed system
 * block 1 or the identity stack; the readers above are all Host messages,
 * trailing sections, one-shot prompts or tool results.
 *
 * ## Metadata
 *
 * Raw `metadata` never reaches a model. This is the second sanctioned derived
 * reader of its reserved `progressions` key (after the per-turn report), and
 * it reads only what `parseProgressions` validates.
 */

import { logger } from '@/lib/logger'
import { getMemoryTimeZone } from '@/lib/memory/time/calendar'
import { deriveProgression, parseProgressions, renderPublicProgressionLine } from '@/lib/progressions/engine'
import { currentAge } from './birthday'

const CONTEXT = 'characters.public-identity'

/** The fields this module reads — a structural subset of `Character`. */
export interface PublicIdentitySubject {
  id?: string
  name?: string
  birthday?: string | null
  pronouns?: { subject: string; object: string; possessive: string } | null
  metadata?: unknown
}

export interface PublicIdentityOptions {
  /** The wall clock, injected for tests. Defaults to `Date.now()`. */
  nowMs?: number
  /** The calendar a birthday is counted on. Defaults to the instance calendar. */
  timeZone?: string
}

/** The known facts, each already rendered. Empty fields are absent, not blank. */
export interface PublicIdentityFacts {
  age: number | null
  /** One line per public progression, sorted by id. */
  progressions: string[]
  /** `subject/object/possessive`, or null. */
  pronouns: string | null
}

export function publicIdentityFacts(
  character: PublicIdentitySubject,
  opts: PublicIdentityOptions = {},
): PublicIdentityFacts {
  const nowMs = opts.nowMs ?? Date.now()
  const timeZone = opts.timeZone ?? getMemoryTimeZone()

  const age = currentAge(character.birthday, nowMs, timeZone)

  const parsed = parseProgressions(character.metadata, (id, issue) => {
    logger.debug('Leaving a malformed progression out of the public identity', {
      context: CONTEXT,
      characterId: character.id,
      progressionId: id,
      issue,
    })
  })
  const progressions: string[] = []
  for (const id of Object.keys(parsed).sort()) {
    const line = renderPublicProgressionLine(parsed[id], deriveProgression(id, parsed[id], nowMs))
    if (line) progressions.push(line)
  }

  const p = character.pronouns
  const pronouns = p ? `${p.subject}/${p.object}/${p.possessive}` : null

  logger.debug('Composed public identity facts', {
    context: CONTEXT,
    characterId: character.id,
    hasAge: age !== null,
    publicProgressions: progressions.length,
    hasPronouns: pronouns !== null,
  })

  return { age, progressions, pronouns }
}

/** The facts as lines, in their fixed order: age, public progressions, pronouns. */
export function renderPublicIdentityFacts(facts: PublicIdentityFacts): string[] {
  const lines: string[] = []
  if (facts.age !== null) lines.push(`Age: ${facts.age}`)
  lines.push(...facts.progressions)
  if (facts.pronouns) lines.push(`Pronouns: ${facts.pronouns}`)
  return lines
}

/**
 * The full public identity: the known facts, a blank line, then `body` — the
 * author's identity text, already template-bound by the caller. Either half
 * may be empty; when both are, the result is `''`.
 */
export function composePublicIdentity(
  character: PublicIdentitySubject,
  body: string | null | undefined,
  opts: PublicIdentityOptions = {},
): string {
  const facts = renderPublicIdentityFacts(publicIdentityFacts(character, opts)).join('\n')
  const text = (body ?? '').trim()
  if (facts && text) return `${facts}\n\n${text}`
  return facts || text
}
