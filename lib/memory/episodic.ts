/**
 * Episodic-spine helpers (episodic recall overhaul).
 *
 * Small, pure utilities shared by the write path (memory-service, memory-gate,
 * extraction) and the read path (injector, tools):
 *
 *  - {@link buildMemoryAnchorLine} / {@link buildMemoryEmbeddingText}: the
 *    `(when: 2026-07-14 · place: Lighthouse Point)` anchor line appended to a
 *    memory's embedded text so the vector itself carries temporal/place signal.
 *  - {@link resolveWhenPhrase}: deterministic server-side resolution of a
 *    model-emitted `when` phrase (absolute or relative) into an ISO
 *    `occurredAt`, anchored to the source turn's timestamp.
 *  - {@link eventReferenceTimeMs}: the event clock (`occurredAt ?? write
 *    clock`) used for age labels — distinct from the decay reference time in
 *    memory-weighting, which stays on the write/reinforce clock.
 *
 * Pure + I/O-free so it is trivially unit-testable and safe to import from the
 * forked job child.
 */

import {
  getMemoryTimeZone,
  startOfZonedDayMs,
  startOfZonedWeekMs,
  zonedDateStamp,
  zonedDayBoundsIso,
  zonedParts,
  zonedTimeOnDayMs,
  zonedTimeToUtcMs,
} from './memory-calendar'

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
 * Build the canonical embedded text for a memory: `summary\n\ncontent`, plus
 * the anchor line when any episodic anchor is present. Single source of truth —
 * the gate, the create paths, re-embeds, and reinforcement must all agree or
 * the gate compares against differently-shaped vectors than it writes.
 *
 * New writes only carry the anchor; legacy rows re-embed without one until the
 * optional batched re-embed runs. Mixed old/new embedded-text rows are an
 * accepted, indefinite state (see the spec's cross-cutting list).
 *
 * `timeZone` is passed through to {@link buildMemoryAnchorLine}; every caller
 * resolves it with `refreshMemoryTimeZone()` first.
 */
export function buildMemoryEmbeddingText(
  summary: string,
  content: string,
  anchors?: EpisodicAnchorView | null,
  timeZone?: string,
): string {
  const base = `${summary}\n\n${content}`
  const anchorLine = anchors ? buildMemoryAnchorLine(anchors, timeZone) : ''
  return anchorLine ? `${base}\n${anchorLine}` : base
}

/** Milliseconds per day. */
const DAY_MS = 86_400_000

const MONTH_NAMES: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

const UNIT_MS: Record<string, number> = {
  day: DAY_MS,
  days: DAY_MS,
  week: 7 * DAY_MS,
  weeks: 7 * DAY_MS,
  month: 30 * DAY_MS,
  months: 30 * DAY_MS,
  year: 365 * DAY_MS,
  years: 365 * DAY_MS,
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3,
}

/**
 * Deterministically resolve a `when` phrase into an ISO `occurredAt`, anchored
 * to `anchorIso` (the source turn's message timestamp), on the instance's
 * memory calendar (`timeZone`, default {@link getMemoryTimeZone}). Handles:
 *
 *  - Absolute ISO datetimes (`2026-07-14T09:30:00Z`) as given; ISO dates
 *    (`2026-07-14`) as that day's local midnight
 *  - `Month day[, year]` / `day Month [year]` (year defaults to the anchor's,
 *    rolled back a year if that lands in the anchor's future) — local midnight
 *  - `today` / `tonight` / `this morning…` / `this week` → the anchor itself
 *  - `yesterday`, `day before yesterday`, `N days/weeks/months/years ago`,
 *    `last month/year`, `last <weekday>`, `a couple/few days ago` — local
 *    midnight of the resolved day
 *  - `last night` → 18:00 local the previous day; `last week` → Monday 00:00
 *    local of the previous week
 *
 * Bug 212: every phrase the read side's day-reference scan
 * (`day-references.ts`) also knows is stamped at the START of the same local
 * window the read side returns for it, from the same calendar, so a memory
 * written as "last night" lands inside "last night" read. Rows written before
 * this fix were re-stamped from UTC midnight to local midnight of the same
 * calendar date by the rezone-legacy-memory-occurred-at-v1 migration.
 *
 * Returns null for anything unrecognized (including future-tense phrases) —
 * recall must degrade, never block, so an unresolvable phrase simply leaves
 * `occurredAt` to the fallback stamping rule.
 */
export function resolveWhenPhrase(
  phrase: string | null | undefined,
  anchorIso: string,
  timeZone: string = getMemoryTimeZone(),
): string | null {
  const raw = phrase?.trim()
  if (!raw) return null
  const anchorMs = Date.parse(anchorIso)
  if (!Number.isFinite(anchorMs)) return null
  const lower = raw.toLowerCase()
  const tz = timeZone
  const iso = (ms: number) => new Date(ms).toISOString()
  /** Local midnight `days` calendar days before the anchor's local day. */
  const daysBack = (days: number) => iso(startOfZonedDayMs(anchorMs, tz, -days))

  // Absolute ISO datetime / date.
  const isoMatch = lower.match(/^(\d{4})-(\d{2})-(\d{2})(t[\d:.]+(z|[+-]\d{2}:?\d{2})?)?$/)
  if (isoMatch) {
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) {
      if (isoMatch[4]) return iso(parsed)
      const day = zonedDayBoundsIso(lower.slice(0, 10), tz)
      return day ? day.from : null
    }
    return null
  }

  // "July 14, 2026" / "July 14" / "14 July 2026" / "14 July"
  const monthFirst = lower.match(/^(?:on\s+)?([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/)
  const dayFirst = lower.match(/^(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)(?:,?\s+(\d{4}))?$/)
  const named = monthFirst && MONTH_NAMES[monthFirst[1]] !== undefined
    ? { month: MONTH_NAMES[monthFirst[1]], day: parseInt(monthFirst[2], 10), year: monthFirst[3] ? parseInt(monthFirst[3], 10) : null }
    : dayFirst && MONTH_NAMES[dayFirst[2]] !== undefined
      ? { month: MONTH_NAMES[dayFirst[2]], day: parseInt(dayFirst[1], 10), year: dayFirst[3] ? parseInt(dayFirst[3], 10) : null }
      : null
  if (named && named.day >= 1 && named.day <= 31) {
    let year = named.year ?? zonedParts(anchorMs, tz).year
    let candidate = zonedTimeToUtcMs(year, named.month, named.day, 0, tz)
    // A yearless date that lands after the anchor refers to the previous year
    // (retold events are in the past).
    if (named.year === null && candidate > anchorMs) {
      year -= 1
      candidate = zonedTimeToUtcMs(year, named.month, named.day, 0, tz)
    }
    return iso(candidate)
  }

  // The anchor moment itself.
  if (/^(today|tonight|this (morning|afternoon|evening|night|week)|earlier( today)?|just now|now)$/.test(lower)) {
    return iso(anchorMs)
  }

  // The read side's "last night" window opens at 18:00 local the day before.
  if (lower === 'last night') {
    return iso(zonedTimeOnDayMs(anchorMs, tz, -1, 18))
  }
  if (lower === 'yesterday') return daysBack(1)
  if (/^(the )?day before yesterday$/.test(lower)) return daysBack(2)

  // "N days ago", "a week ago", "a couple of months ago", "few days back"
  const agoMatch = lower.match(/^(?:about\s+|around\s+|some\s+)?([a-z]+|\d+)\s+(?:of\s+)?(days?|weeks?|months?|years?)\s+(?:ago|back|earlier|before)$/)
  if (agoMatch) {
    const n = /^\d+$/.test(agoMatch[1]) ? parseInt(agoMatch[1], 10) : WORD_NUMBERS[agoMatch[1]]
    const unit = UNIT_MS[agoMatch[2]]
    if (n !== undefined && n > 0 && n < 10000 && unit) {
      return daysBack(n * (unit / DAY_MS))
    }
  }
  // "a couple of days ago" (couple/few consume an extra "of" word slot)
  const coupleMatch = lower.match(/^a\s+(couple|few)\s+(?:of\s+)?(days?|weeks?|months?|years?)\s+(?:ago|back)$/)
  if (coupleMatch) {
    const n = WORD_NUMBERS[coupleMatch[1]]
    const unit = UNIT_MS[coupleMatch[2]]
    if (n && unit) return daysBack(n * (unit / DAY_MS))
  }

  // "last week" is the previous Monday-anchored local week, as on the read side.
  if (/^last week$/.test(lower)) return iso(startOfZonedWeekMs(anchorMs, tz, -1))
  if (/^last month$/.test(lower)) return daysBack(30)
  if (/^last year$/.test(lower)) return daysBack(365)
  if (/^the other day$/.test(lower)) return daysBack(2)

  // "last <weekday>" — the most recent strictly-past occurrence of that weekday.
  const weekdayMatch = lower.match(/^last\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/)
  if (weekdayMatch) {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const target = weekdays.indexOf(weekdayMatch[1])
    const anchorDay = zonedParts(anchorMs, tz).weekday
    const back = ((anchorDay - target + 7) % 7) || 7
    return daysBack(back)
  }

  const seasonMatch = lower.match(/^last\s+(spring|summer|fall|autumn|winter)$/)
  if (seasonMatch) {
    // Coarse: treat "last <season>" as ~6 months back. Precision is not the
    // point — landing in the right half-year is enough for window retrieval.
    return daysBack(182)
  }

  return null
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
