/**
 * Wear-ledger display helpers
 *
 * Client-safe, pure helpers for the operator-facing half of the wear ledger:
 * the one muted line under a wardrobe row (`Worn 4× · last …`), and the sort
 * and "Never worn" filter in the Wardrobe dialog's list.
 *
 * Every wardrobe collection read attaches a `wear` annotation (a
 * {@link WardrobeWearSummary}) to each item. It is a response annotation, not
 * a field of the item, so an item that arrived without one is read as never
 * worn — {@link wearOf} is the one place that rule lives.
 *
 * Design of record: docs/developer/features/complete/wardrobe-wear-ledger.md §5.2–§5.3
 *
 * @module lib/wardrobe/wear-display
 */

import { formatRelativeDays } from '@/lib/format-time'
import { neverWornSummary, type WardrobeWearSummary } from '@/lib/schemas/wardrobe-wear.types'

/** Anything that may carry the collection read's `wear` annotation. */
export interface WearAnnotated {
  wear?: WardrobeWearSummary | null
}

/** The item's wear summary, or the canonical "never worn" one when absent. */
export function wearOf(item: WearAnnotated): WardrobeWearSummary {
  return item.wear ?? neverWornSummary()
}

/** True when the ledger has no wear on record for this item. */
export function isNeverWorn(item: WearAnnotated): boolean {
  return wearOf(item).wearCount <= 0
}

/**
 * The row's one-line tally:
 *
 *  - `Never worn`
 *  - `Worn once · last 3 weeks ago`
 *  - `Worn 4× · last yesterday`
 *
 * The date is day-level ({@link formatWornWhen}); `nowMs` is injectable so the
 * line can be tested against a fixed clock. A positive count with no recorded
 * date (should not happen, but a hand-edited row could) drops the date part
 * rather than printing an empty `last`.
 */
export function formatWearLine(
  summary: WardrobeWearSummary | null | undefined,
  nowMs: number = Date.now(),
): string {
  const wear = summary ?? neverWornSummary()
  if (wear.wearCount <= 0) return 'Never worn'
  const count = wear.wearCount === 1 ? 'Worn once' : `Worn ${wear.wearCount}×`
  const when = formatWornWhen(wear.lastWornAt, nowMs)
  if (!when) return count
  return `${count} · last ${when}`
}

/**
 * A wear date as the ledger speaks of it — day-level and relative ("today",
 * "3 days ago", "last week"), the same ladder the character tools use. Empty
 * for a missing or unparseable date.
 */
export function formatWornWhen(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  return Number.isNaN(ts) ? '' : formatRelativeDays(ts, nowMs)
}

// ============================================================================
// SORT + FILTER (Wardrobe dialog list)
// ============================================================================

/** The Wardrobe dialog's list orderings. `title` is today's order and the default. */
export type WardrobeListSort = 'title' | 'recently-worn' | 'most-worn' | 'newest'

export const WARDROBE_LIST_SORTS: ReadonlyArray<{ value: WardrobeListSort; label: string }> = [
  { value: 'title', label: 'Title' },
  { value: 'recently-worn', label: 'Recently worn' },
  { value: 'most-worn', label: 'Most worn' },
  { value: 'newest', label: 'Newest' },
]

/** The minimum a list row needs to be sorted and filtered here. */
export interface SortableWardrobeItem extends WearAnnotated {
  title: string
  createdAt?: string | null
}

function timeOf(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/** Descending on a nullable number; nulls sort last. */
function compareDescNullsLast(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}

/**
 * Sort a list of wardrobe items. Never mutates the input. The secondary key is
 * always the title, so equal keys (and the whole never-worn tail under the two
 * wear sorts) read alphabetically.
 *
 *  - `title` — A→Z.
 *  - `recently-worn` — most recent `lastWornAt` first; never-worn items last.
 *  - `most-worn` — highest `wearCount` first; never-worn items last.
 *  - `newest` — most recent `createdAt` first.
 */
export function sortWardrobeItems<T extends SortableWardrobeItem>(
  items: readonly T[],
  sort: WardrobeListSort,
): T[] {
  const byTitle = (a: T, b: T): number => a.title.localeCompare(b.title)
  const sorted = [...items]
  switch (sort) {
    case 'recently-worn':
      return sorted.sort((a, b) => {
        const wa = wearOf(a)
        const wb = wearOf(b)
        const ka = wa.wearCount > 0 ? timeOf(wa.lastWornAt) : null
        const kb = wb.wearCount > 0 ? timeOf(wb.lastWornAt) : null
        return compareDescNullsLast(ka, kb) || byTitle(a, b)
      })
    case 'most-worn':
      return sorted.sort((a, b) => {
        const ca = wearOf(a).wearCount
        const cb = wearOf(b).wearCount
        return compareDescNullsLast(ca > 0 ? ca : null, cb > 0 ? cb : null) || byTitle(a, b)
      })
    case 'newest':
      return sorted.sort(
        (a, b) => compareDescNullsLast(timeOf(a.createdAt), timeOf(b.createdAt)) || byTitle(a, b),
      )
    case 'title':
    default:
      return sorted.sort(byTitle)
  }
}

/**
 * Sort, then (optionally) keep only never-worn items. The filter composes with
 * any sort — it is a filter, not an ordering.
 */
export function sortAndFilterWardrobeItems<T extends SortableWardrobeItem>(
  items: readonly T[],
  opts: { sort: WardrobeListSort; neverWornOnly: boolean },
): T[] {
  const sorted = sortWardrobeItems(items, opts.sort)
  return opts.neverWornOnly ? sorted.filter(isNeverWorn) : sorted
}
