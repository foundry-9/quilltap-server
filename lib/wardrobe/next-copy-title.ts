/**
 * Compute the title for a duplicated wardrobe item.
 *
 * Appends `(copy)` to the source title, escalating to `(copy 2)`, `(copy 3)`,
 * … when earlier copies already exist. Any trailing `(copy)` / `(copy N)`
 * suffix on the source is stripped first, so duplicating `Shirt (copy)` yields
 * `Shirt (copy 2)` rather than `Shirt (copy) (copy)`.
 *
 * @module lib/wardrobe/next-copy-title
 */

/** Matches a trailing ` (copy)` or ` (copy <N>)` suffix, case-insensitive. */
const COPY_SUFFIX = /\s*\(copy(?:\s+\d+)?\)\s*$/i

/**
 * Pick the next free `(copy)` / `(copy N)` title for a duplicated item.
 *
 * @param sourceTitle The title being duplicated.
 * @param existingTitles Titles already in use (collision is case-insensitive).
 */
export function nextCopyTitle(sourceTitle: string, existingTitles: string[]): string {
  const base = sourceTitle.replace(COPY_SUFFIX, '').trim() || sourceTitle.trim()
  const taken = new Set(existingTitles.map((t) => t.trim().toLowerCase()))

  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${base} (copy)` : `${base} (copy ${n})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}
