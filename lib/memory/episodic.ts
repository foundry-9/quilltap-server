/**
 * Episodic-spine helpers (episodic recall overhaul).
 *
 * Small, pure utilities shared by the write path (memory-service, memory-gate,
 * extraction) and the read path (injector, tools):
 *
 *  - {@link buildMemoryAnchorLine}: the `(when: 2026-07-14 · place: Lighthouse
 *    Point)` anchor line appended to a memory's embedded text (built by
 *    `embeddingTextFor` in `lib/memory/index-store`) so the vector itself
 *    carries temporal/place signal.
 *  (Resolving a model's `when` phrase into an `occurredAt` lives with the
 *  read-side day references in `lib/memory/time`, on one rule table.)
 *  - {@link eventReferenceTimeMs}: the event clock (`occurredAt ?? write
 *    clock`) used for age labels — distinct from the decay reference time in
 *    `lib/memory/scoring`, which stays on the write/reinforce clock.
 *
 * Pure + I/O-free so it is trivially unit-testable and safe to import from the
 * forked job child.
 */

import { getMemoryTimeZone, zonedDateStamp } from './time/calendar'

/** Structural view of the episodic fields (keeps this module Memory-import-free). */
export interface EpisodicAnchorView {
  occurredAt?: string | null
  narrativeTime?: string | null
  entities?: readonly string[] | null
}

/** Cap on entities rendered into the anchor line so it stays one line. */
const ANCHOR_MAX_ENTITIES = 4

/**
 * Render the anchor line appended to a memory's embedded text, e.g.
 * `(when: 2026-07-14 · place: Lighthouse Point)`. Returns `''` when the memory
 * carries no anchors, so callers can append unconditionally. The date is
 * rendered as the local calendar date on the memory calendar (time-of-day adds noise, not signal, to
 * the embedding); `narrativeTime` rides along verbatim when present.
 *
 * `timeZone` is the memory-calendar zone to render the date in. Callers pass
 * `await refreshMemoryTimeZone()` so a cold cache (a fresh job child) cannot
 * embed a different date than the parent would; absent, the cached zone (or
 * its env/system fallback) applies.
 */
export function buildMemoryAnchorLine(view: EpisodicAnchorView, timeZone?: string): string {
  const parts: string[] = []
  const occurredAt = view.occurredAt?.trim()
  if (occurredAt) {
    // The calendar date on the instance's memory calendar (bug 212): a local
    // midnight stored as UTC east of Greenwich would otherwise read a day early.
    // Legacy UTC-midnight point dates were re-stamped at local midnight by the
    // rezone-legacy-memory-occurred-at-v1 migration, so they read their own day.
    const parsed = Date.parse(occurredAt)
    const dateOnly = Number.isFinite(parsed)
      ? zonedDateStamp(parsed, timeZone ?? getMemoryTimeZone())
      : occurredAt.slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
      parts.push(`when: ${dateOnly}`)
    }
  }
  const narrativeTime = view.narrativeTime?.trim()
  if (narrativeTime) {
    parts.push(`story time: ${narrativeTime}`)
  }
  const entities = (view.entities ?? [])
    .map(e => (typeof e === 'string' ? e.trim() : ''))
    .filter(e => e.length > 0)
    .slice(0, ANCHOR_MAX_ENTITIES)
  if (entities.length > 0) {
    parts.push(`place: ${entities.join(', ')}`)
  }
  if (parts.length === 0) return ''
  return `(${parts.join(' · ')})`
}

/**
 * Event-clock reference time for age labels: prefer `occurredAt` (when the
 * event happened) over the write/reinforce clock. Falls back to the supplied
 * write-clock milliseconds when `occurredAt` is absent or unparsable.
 */
export function eventReferenceTimeMs(
  occurredAt: string | null | undefined,
  writeClockMs: number,
): number {
  if (occurredAt) {
    const parsed = Date.parse(occurredAt)
    if (Number.isFinite(parsed)) return parsed
  }
  return writeClockMs
}
