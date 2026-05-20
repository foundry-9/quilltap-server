/**
 * About-character resolution helpers
 *
 * Shared logic for deciding whether a memory's `aboutCharacterId` plausibly
 * matches the memory content, and for collapsing it to the holder character
 * (self-reference) when the about-character isn't named in the text.
 *
 * Used at runtime by `createMemoryWithGate` (memory creation chokepoint) and
 * at backfill time by the `align-about-character-id` migrations so both paths
 * apply identical rules.
 */
import type { Character } from '@/lib/schemas/types'
import { escapeRegex } from '@/lib/utils/regex'

/**
 * Generic aliases that cheap-LLM extraction prompts use for the human user.
 * Included in the alias set whenever the about-character is `controlledBy:'user'`.
 */
export const USER_GENERIC_ALIASES: readonly string[] = ['user', 'the user']

/**
 * Build the set of names + aliases used to decide whether a memory is about
 * the given character. For user-controlled characters, augments the set with
 * generic "user"/"the user" aliases that extraction prompts emit.
 */
export function namesForAboutCharacter(character: Pick<Character, 'name' | 'aliases' | 'controlledBy'>): string[] {
  const names: string[] = [character.name, ...(character.aliases ?? [])]
  if (character.controlledBy === 'user') {
    names.push(...USER_GENERIC_ALIASES)
  }
  return names.filter(n => typeof n === 'string' && n.trim().length > 0)
}

/**
 * Build the set of names used to decide whether a memory is *about the holder*.
 * Excludes the generic "user" / "the user" aliases — those are meaningful only
 * for matching the user-controlled about-target, not the holder's identity in
 * extraction text. Symmetric with `namesForAboutCharacter` aside from that gap.
 */
export function namesForHolder(character: Pick<Character, 'name' | 'aliases'>): string[] {
  return [character.name, ...(character.aliases ?? [])].filter(
    n => typeof n === 'string' && n.trim().length > 0,
  )
}

function buildNameRegex(name: string, flags: string): RegExp {
  // Word-boundary check that recognises Unicode letters/digits without using
  // \b (which is ASCII-only). Mirrors the rule used since v1 — preserved here
  // so any rewrite of the heuristic stays in lockstep with the v1 migration.
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegex(name)}(?=$|[^\\p{L}\\p{N}_])`, flags)
}

/**
 * Word-boundary, case-insensitive presence check for any of the supplied
 * names in the haystack. Empty/whitespace names are ignored.
 */
export function nameAppears(names: readonly string[], haystack: string): boolean {
  if (!haystack) return false
  for (const raw of names) {
    const name = raw?.trim()
    if (!name) continue
    if (buildNameRegex(name, 'iu').test(haystack)) return true
  }
  return false
}

/**
 * Word-boundary, case-insensitive occurrence count summed across the supplied
 * names. Used by the holder-vs-about-character tiebreaker so that — when both
 * are named in the same memory — the side mentioned more often wins. Empty
 * and whitespace-only names are ignored.
 */
export function countNameOccurrences(names: readonly string[], haystack: string): number {
  if (!haystack) return 0
  let total = 0
  for (const raw of names) {
    const name = raw?.trim()
    if (!name) continue
    const matches = haystack.match(buildNameRegex(name, 'giu'))
    if (matches) total += matches.length
  }
  return total
}

/**
 * Decide what aboutCharacterId a memory should carry, given the holder
 * character, the proposed about-character (or null), and the memory text.
 *
 * Rules (applied in order):
 *  1. Null aboutCharacterId → fall through unchanged. Callers decide what
 *     null means (the migration treats null as a candidate for flipping to
 *     the holder; runtime treats it as "no user character known").
 *  2. Self-reference (`proposedAboutCharacterId === holderCharacterId`) → keep.
 *  3. About-character data unavailable (deleted, etc.) → keep; we can't
 *     disprove the attribution without name data.
 *  4. About-character's name set absent from text → flip to holder.
 *  5. **Tiebreaker (v2):** when about-character IS named, count holder's
 *     name occurrences too. If the holder is named **strictly more often**
 *     than the about-character, the memory is dominantly about the holder
 *     — flip to self. Ties go to the about-character (Q3 from the original
 *     design).
 *  6. Otherwise → keep the about-character attribution.
 *
 * `holderCharacter` is optional: when supplied, the tiebreaker can run.
 * Without it (legacy callers, deleted-holder edge cases), only rules 1–4
 * and 6 apply.
 */
export function resolveAboutCharacterId(args: {
  holderCharacterId: string
  holderCharacter?: Pick<Character, 'name' | 'aliases'> | null
  proposedAboutCharacterId: string | null
  proposedAboutCharacter: Pick<Character, 'name' | 'aliases' | 'controlledBy'> | null
  text: string
}): { aboutCharacterId: string | null; flipped: boolean; reason?: 'holder-dominates' } {
  const {
    holderCharacterId,
    holderCharacter,
    proposedAboutCharacterId,
    proposedAboutCharacter,
    text,
  } = args
  if (!proposedAboutCharacterId) {
    return { aboutCharacterId: null, flipped: false }
  }
  if (proposedAboutCharacterId === holderCharacterId) {
    return { aboutCharacterId: holderCharacterId, flipped: false }
  }
  if (!proposedAboutCharacter) {
    return { aboutCharacterId: proposedAboutCharacterId, flipped: false }
  }

  const aboutNames = namesForAboutCharacter(proposedAboutCharacter)
  const aboutCount = countNameOccurrences(aboutNames, text)
  if (aboutCount === 0) {
    return { aboutCharacterId: holderCharacterId, flipped: true }
  }

  if (holderCharacter) {
    const holderNames = namesForHolder(holderCharacter)
    const holderCount = countNameOccurrences(holderNames, text)
    if (holderCount > aboutCount) {
      return { aboutCharacterId: holderCharacterId, flipped: true, reason: 'holder-dominates' }
    }
  }

  return { aboutCharacterId: proposedAboutCharacterId, flipped: false }
}
