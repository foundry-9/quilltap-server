/**
 * Text helpers shared by the research kit: name folding, edit distance, the
 * nearest names to a miss, the folded matcher (the same folding as
 * `doc_grep`'s literal search — case, accents and typography), and the result
 * ceiling.
 *
 * @module lib/research/text
 */

import { findAllMatches } from '@/lib/doc-edit/diacritics'

/** Fold a name for comparison: accents, case and spacing. */
export function foldName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Levenshtein distance. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/**
 * The `count` candidates nearest to `target` by edit distance on folded text,
 * with a containing candidate preferred. Distinct, nearest first.
 */
export function nearestByName(target: string, candidates: readonly string[], count: number): string[] {
  const needle = foldName(target)
  if (!needle) return []
  const scored = new Map<string, number>()
  for (const candidate of candidates) {
    const folded = foldName(candidate)
    if (!folded || scored.has(candidate)) continue
    const base = folded.includes(needle) || needle.includes(folded) ? 0 : 1
    // Compare against the candidate's last path segment as well, so a filename
    // miss finds the file whatever folder it sits in.
    const leaf = folded.split('/').pop() ?? folded
    const distance = Math.min(editDistance(needle, folded), editDistance(needle, leaf))
    scored.set(candidate, base * 1000 + distance)
  }
  return [...scored.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([name]) => name)
}

/**
 * Split a `text` argument into the phrases a document must contain: a quoted
 * phrase is one term, every other word is its own. All must match.
 */
export function searchTerms(text: string): string[] {
  const terms: string[] = []
  const re = /"([^"]+)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const term = (m[1] ?? m[2] ?? '').trim()
    if (term) terms.push(term)
  }
  return terms
}

/** Every match of `term` in `content`, folded as `doc_grep`'s literal search folds. */
export function foldedMatches(content: string, term: string): Array<{ index: number; length: number }> {
  return findAllMatches(content, term, { caseSensitive: false, normalizeDiacritics: true, foldTypography: true })
}

/** Whether every term occurs in `content`. */
export function containsAll(content: string, terms: readonly string[]): boolean {
  return terms.every((term) => foldedMatches(content, term).length > 0)
}

/** Whether every word of `name` occurs in `value` (folded). */
export function nameMatches(value: string, nameWords: readonly string[]): boolean {
  const folded = foldName(value)
  return nameWords.every((word) => folded.includes(foldName(word)))
}

/** The calendar date of an ISO timestamp (its first ten characters); empty when there is none. */
export function dateOf(iso: string | null | undefined): string {
  return (iso ?? '').slice(0, 10)
}

/** Clip a line to `max` characters with an ellipsis. */
export function clipLine(line: string, max: number): string {
  const trimmed = line.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/** The soft ceiling on a research-kit result, in characters (research kit §5.8). */
export const RESEARCH_RESULT_CEILING = 6000

/**
 * Join result records under the ceiling: records are kept whole and in order
 * until the next would pass it; the rest are counted in one closing line that
 * says which argument fetches them.
 */
export function joinUnderCeiling(
  head: string,
  records: readonly string[],
  opts: { tail?: string; omittedHint: (omitted: number) => string; ceiling?: number; separator?: string },
): string {
  const ceiling = opts.ceiling ?? RESEARCH_RESULT_CEILING
  const separator = opts.separator ?? '\n\n'
  const parts: string[] = [head]
  let used = head.length + (opts.tail?.length ?? 0)
  let kept = 0
  for (const record of records) {
    if (kept > 0 && used + record.length + separator.length > ceiling) break
    parts.push(record)
    used += record.length + separator.length
    kept++
  }
  const omitted = records.length - kept
  if (omitted > 0) parts.push(opts.omittedHint(omitted))
  else if (opts.tail) parts.push(opts.tail)
  return parts.join(separator)
}

/**
 * Cut a structured lookup result under the ceiling at a record boundary: drop
 * records from the end of `result[key]` until the result fits, then say what
 * was left out and which argument fetches it. Returns the result unchanged
 * when it already fits.
 */
export function capRecords<T extends Record<string, unknown>>(
  result: T,
  key: keyof T & string,
  hint: (omitted: number) => string,
  ceiling: number = RESEARCH_RESULT_CEILING,
): T {
  const records = result[key]
  if (!Array.isArray(records)) return result
  if (JSON.stringify(result).length <= ceiling) return result
  const kept = [...records]
  let omitted = 0
  while (kept.length > 1) {
    kept.pop()
    omitted++
    if (JSON.stringify({ ...result, [key]: kept }).length <= ceiling) break
  }
  return { ...result, [key]: kept, omitted: hint(omitted) }
}
