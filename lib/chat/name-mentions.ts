/**
 * Finding a character's name in text — the one matcher behind the referent
 * ledger (`lib/chat/context/referent-ledger.ts`) and the Salon's name chips for
 * absent characters (`lib/chat/absent-mentions.ts`), so the model and the
 * operator agree on what counts as a mention.
 *
 * Case-sensitive and letter-bounded: an alias like "Doc" or "Ember" is a common
 * word in lower case, and "Vergilian" is not Vergil. Longer tokens win, so
 * "Mrs. Sebold" is preferred over "Sebold". Pure and client-safe.
 */

import { escapeRegex } from '@/lib/utils/regex'

/**
 * A global matcher for any of `names` (a name and its aliases), or null when
 * none is usable. Callers reset `lastIndex` before reuse.
 *
 * `caseInsensitive` (default `false`, which every people-matcher keeps) folds
 * case: the Atlas's things are common nouns ("the car", "Car"), where a
 * person's alias is not (`lib/atlas/match.ts`).
 */
export function buildNameMatcher(
  names: ReadonlyArray<string | null | undefined>,
  opts: { caseInsensitive?: boolean } = {},
): RegExp | null {
  const caseInsensitive = opts.caseInsensitive === true
  const tokens = new Map<string, string>()
  for (const token of names) {
    const trimmed = token?.trim()
    if (!trimmed) continue
    const key = caseInsensitive ? trimmed.toLowerCase() : trimmed
    if (!tokens.has(key)) tokens.set(key, trimmed)
  }
  if (tokens.size === 0) return null
  const alternation = Array.from(tokens.values())
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join('|')
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternation})(?![\\p{L}\\p{N}_])`, caseInsensitive ? 'giu' : 'gu')
}

/** The first match of `matcher` in `text`, or null. */
export function firstNameMatch(text: string, matcher: RegExp): { index: number; text: string } | null {
  matcher.lastIndex = 0
  const m = matcher.exec(text)
  return m ? { index: m.index, text: m[0] } : null
}

/** The last match of `matcher` in `text`, or null. */
export function lastNameMatch(text: string, matcher: RegExp): { index: number; text: string } | null {
  matcher.lastIndex = 0
  let last: RegExpExecArray | null = null
  let m: RegExpExecArray | null
  while ((m = matcher.exec(text)) !== null) last = m
  return last ? { index: last.index, text: last[0] } : null
}
