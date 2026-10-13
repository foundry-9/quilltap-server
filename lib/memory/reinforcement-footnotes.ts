/**
 * Reinforcement footnotes: the `[+] detail` lines a retelling appends to the
 * memory it reinforces.
 *
 * Pure and dependency-free, so the memories repository can apply them inside
 * its write transaction against the row as it stands at commit time, and the
 * job child's overlay can apply the same rule to its local view. Two jobs that
 * each reinforce one row therefore both land their footnotes, instead of the
 * later job's whole-content write replacing the earlier one's (bug 231).
 *
 * @module memory/reinforcement-footnotes
 */

/**
 * Most `[+]` footnote lines a memory may carry. Past this, reinforcement still
 * bumps count/importance and unions entities, but appends no more prose and
 * skips the re-embed — an unbounded tail drifts the row's vector toward a bag
 * of proper nouns.
 */
export const MAX_REINFORCEMENT_FOOTNOTES = 8

const FOOTNOTE_PREFIX = '[+] '

/** Number of `[+]` footnote lines already appended to a memory's content. */
export function countReinforcementFootnotes(content: string): number {
  let count = 0
  for (const line of content.split('\n')) {
    if (line.startsWith(FOOTNOTE_PREFIX)) count++
  }
  return count
}

/**
 * Append novel details to `content` as `[+]` footnotes, stopping at
 * {@link MAX_REINFORCEMENT_FOOTNOTES}. A detail whose footnote line the content
 * already carries is skipped, so applying the same details twice (a replay, or
 * two jobs that found the same detail) appends them once. Returns the new
 * content and the details actually appended (in order, possibly empty).
 */
export function appendCappedFootnotes(
  content: string,
  details: readonly string[],
): { content: string; appended: string[] } {
  const present = new Set(
    content.split('\n').filter(line => line.startsWith(FOOTNOTE_PREFIX)),
  )
  const room = Math.max(0, MAX_REINFORCEMENT_FOOTNOTES - countReinforcementFootnotes(content))
  const appended: string[] = []
  for (const detail of details) {
    if (appended.length >= room) break
    const line = `${FOOTNOTE_PREFIX}${detail}`
    if (present.has(line)) continue
    present.add(line)
    appended.push(detail)
  }
  if (appended.length === 0) return { content, appended }
  return { content: `${content}\n${appended.map(d => `${FOOTNOTE_PREFIX}${d}`).join('\n')}`, appended }
}
