/**
 * The memory clock: event time on write, reference windows on read.
 *
 * Both directions resolve against one {@link MemoryClock} — the instance's
 * memory calendar (instance timezone → `QUILLTAP_TIMEZONE` → system; the
 * per-chat display timezone is never consulted) — and through one rule table
 * (`rules.ts`). `resolveEventTime` stamps a phrase at the START of the window
 * the table gives it; `resolveReferenceWindow` returns that whole window. A
 * handful of phrases the read scan leaves to the LLM ("a month ago", "last
 * Tuesday", named dates) have write-only rules here, since an extractor's
 * `when` must still land somewhere.
 *
 * Windows are closed on both ends as ISO strings: `to` is the last instant
 * inside (one millisecond before the next boundary), so an `occurredAt` at a
 * day's midnight belongs to that day only and never to the day before.
 *
 * Pure + I/O-free; safe in the forked job child. The instance timezone lives
 * in the database: async callers resolve it first (`refreshMemoryTimeZone`,
 * or {@link memoryClockFor}) and pass it on the clock.
 *
 * @module memory/time/clock
 */

import {
  getMemoryTimeZone,
  startOfZonedDayMs,
  zonedDayBoundsIso,
  zonedParts,
  zonedTimeToUtcMs,
} from './calendar'
import { DAY_REFERENCE_SCAN_PATTERN, matchDayReferenceRule, type RuleWindow } from './rules'

/** The calendar a memory-time question is answered on, and the instant it is asked at. */
export interface MemoryClock {
  timeZone: string
  nowMs: number
  /** `narrative` chats skip the read-side scan (story time is not the wall calendar). */
  timelineMode?: 'realtime' | 'narrative'
}

/** A closed window of ISO instants. */
export interface TimeWindow {
  from: string
  to: string
}

/** What a phrase in conversation resolved to on the read side. */
export interface DayReferenceResolution {
  /**
   * The window the phrase names. Only meaningful when {@link pastPointing} is
   * true: callers must not apply the window of a future reference.
   */
  timeRange: TimeWindow
  /** True for past references (today/yesterday/…), false for future ("tomorrow"). */
  pastPointing: boolean
  /** Which phrase matched, for logs and the replay output. */
  matched: string
}

/**
 * The clock for a chat, given the instance timezone setting already read.
 * Synchronous; an absent or invalid `instance.timeZone` falls back to the
 * cached instance zone, then `QUILLTAP_TIMEZONE`, then the system zone.
 */
export function clockFor(
  chat: { timelineMode?: 'realtime' | 'narrative' | null } | null | undefined,
  instance: { timeZone?: string | null } = {},
  nowMs: number = Date.now(),
): MemoryClock {
  return {
    timeZone: getMemoryTimeZone(instance.timeZone ?? null),
    nowMs,
    timelineMode: chat?.timelineMode ?? 'realtime',
  }
}

/** {@link clockFor}, reading the instance timezone first (async entry points). */
export async function memoryClockFor(
  chat: { timelineMode?: 'realtime' | 'narrative' | null } | null | undefined,
  nowMs: number = Date.now(),
): Promise<MemoryClock> {
  const { refreshMemoryTimeZone } = await import('./calendar-refresh')
  return clockFor(chat, { timeZone: await refreshMemoryTimeZone(nowMs) }, nowMs)
}

function toWindow(w: RuleWindow): TimeWindow {
  return { from: new Date(w.fromMs).toISOString(), to: new Date(w.endMs - 1).toISOString() }
}

// ---------------------------------------------------------------------------
// Write side
// ---------------------------------------------------------------------------

const MONTH_NAMES: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

const UNIT_DAYS: Record<string, number> = {
  day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30, year: 365, years: 365,
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  couple: 2, few: 3,
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/**
 * Resolve a model's `when` phrase into an `occurredAt`, anchored at
 * `anchorMs` (the source message's time) on `clock.timeZone`'s calendar.
 *
 *  - A phrase the day-reference table knows is stamped at the START of its
 *    window, and the window is returned too ("last night" → 18:00 the day
 *    before; "last week" → the previous Monday; "today" → local midnight).
 *  - Write-only rules: ISO datetimes as given; ISO dates and named dates
 *    ("July 14", "14 July 2026") at local midnight, a yearless date in the
 *    anchor's future rolled back a year; "N days/weeks/months/years ago",
 *    "a couple of days back"; "last month/year/<weekday>/<season>"; "the
 *    other day"; "earlier", "just now", "now" (the anchor itself).
 *  - Anything else, future references included, resolves to null — recall
 *    degrades, never blocks.
 */
export function resolveEventTime(
  phrase: string | null | undefined,
  anchorMs: number,
  clock: Pick<MemoryClock, 'timeZone'>,
): { occurredAt: string | null; window: TimeWindow | null } {
  const none = { occurredAt: null, window: null }
  const raw = phrase?.trim()
  if (!raw || !Number.isFinite(anchorMs)) return none
  const lower = raw.toLowerCase().replace(/\s+/g, ' ')
  const tz = clock.timeZone
  const iso = (ms: number) => new Date(ms).toISOString()
  const daysBack = (days: number) => iso(startOfZonedDayMs(anchorMs, tz, -days))

  // The table: the start of the window the read side asks for.
  const tableHit = matchDayReferenceRule(lower.replace(/^the\s+/, ''))
  if (tableHit) {
    const w = tableHit.rule.window(tableHit.match, anchorMs, tz)
    if (w && w.pastPointing) return { occurredAt: iso(w.fromMs), window: toWindow(w) }
    if (w) return none // a future reference is not an event time
  }

  // Absolute ISO datetime / date.
  const isoMatch = lower.match(/^(\d{4})-(\d{2})-(\d{2})(t[\d:.]+(z|[+-]\d{2}:?\d{2})?)?$/)
  if (isoMatch) {
    const parsed = Date.parse(raw)
    if (!Number.isFinite(parsed)) return none
    if (isoMatch[4]) return { occurredAt: iso(parsed), window: null }
    const dayBounds = zonedDayBoundsIso(lower.slice(0, 10), tz)
    return dayBounds ? { occurredAt: dayBounds.from, window: dayBounds } : none
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
    // A yearless date after the anchor is last year's (retold events are past).
    if (named.year === null && candidate > anchorMs) {
      year -= 1
      candidate = zonedTimeToUtcMs(year, named.month, named.day, 0, tz)
    }
    return { occurredAt: iso(candidate), window: null }
  }

  // The anchor moment itself.
  if (/^(earlier|just now|now|this night)$/.test(lower)) return { occurredAt: iso(anchorMs), window: null }

  // "N days ago", "a week ago", "about 3 months back", "a couple of days ago"
  const agoMatch = lower.match(/^(?:about\s+|around\s+|some\s+)?(?:a\s+(?=couple|few))?([a-z]+|\d+)\s+(?:of\s+)?(days?|weeks?|months?|years?)\s+(?:ago|back|earlier|before)$/)
  if (agoMatch) {
    const n = /^\d+$/.test(agoMatch[1]) ? parseInt(agoMatch[1], 10) : WORD_NUMBERS[agoMatch[1]]
    const unit = UNIT_DAYS[agoMatch[2]]
    if (n !== undefined && n > 0 && n < 10000 && unit) return { occurredAt: daysBack(n * unit), window: null }
  }

  if (lower === 'last month') return { occurredAt: daysBack(30), window: null }
  if (lower === 'last year') return { occurredAt: daysBack(365), window: null }
  if (lower === 'the other day') return { occurredAt: daysBack(2), window: null }

  // "last <weekday>": the most recent strictly-past occurrence.
  const weekdayMatch = lower.match(/^last\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/)
  if (weekdayMatch) {
    const target = WEEKDAYS.indexOf(weekdayMatch[1])
    const anchorDay = zonedParts(anchorMs, tz).weekday
    return { occurredAt: daysBack(((anchorDay - target + 7) % 7) || 7), window: null }
  }

  // Coarse: "last <season>" is about half a year back — enough for windowing.
  if (/^last\s+(spring|summer|fall|autumn|winter)$/.test(lower)) return { occurredAt: daysBack(182), window: null }

  return none
}

/**
 * The string form of {@link resolveEventTime}: a `when` phrase, an ISO
 * anchor, the zone (default the cached instance zone). Returns `occurredAt`
 * or null.
 */
export function resolveWhenPhrase(
  phrase: string | null | undefined,
  anchorIso: string,
  timeZone: string = getMemoryTimeZone(),
): string | null {
  return resolveEventTime(phrase, Date.parse(anchorIso), { timeZone }).occurredAt
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

/**
 * Scan conversation text for a day reference and resolve it to its window at
 * `clock.nowMs`. The latest match in the text wins (the most recent utterance
 * is the turn's focus); an unresolvable match ("97 days ago") does not
 * displace an earlier one. Null when nothing is found. Narrative clocks are
 * the caller's to skip — story time is not the wall calendar.
 */
export function resolveReferenceWindow(text: string, clock: Pick<MemoryClock, 'timeZone' | 'nowMs'>): DayReferenceResolution | null {
  if (!text || !Number.isFinite(clock.nowMs)) return null
  let latest: DayReferenceResolution | null = null
  const scan = new RegExp(DAY_REFERENCE_SCAN_PATTERN.source, DAY_REFERENCE_SCAN_PATTERN.flags)
  let match: RegExpExecArray | null
  while ((match = scan.exec(text)) !== null) {
    const phrase = match[0].toLowerCase().replace(/\s+/g, ' ')
    const hit = matchDayReferenceRule(phrase)
    const w = hit ? hit.rule.window(hit.match, clock.nowMs, clock.timeZone) : null
    if (w) latest = { timeRange: toWindow(w), pastPointing: w.pastPointing, matched: phrase }
    if (match.index === scan.lastIndex) scan.lastIndex++
  }
  return latest
}

/** The `(text, Date, zone)` form of {@link resolveReferenceWindow}. */
export function resolveDayReference(
  text: string,
  now: Date,
  timeZone: string = getMemoryTimeZone(),
): DayReferenceResolution | null {
  return resolveReferenceWindow(text, { timeZone, nowMs: now.getTime() })
}

/**
 * Normalise a model's date-only bound to the local day it names on the
 * memory calendar (`from` → local midnight, `to` → the day's last instant).
 * Full ISO datetimes pass through. Null when either bound is unusable or
 * `from > to`.
 */
export function normaliseTimeRange(
  range: { from?: string | null; to?: string | null } | null | undefined,
  clock: Pick<MemoryClock, 'timeZone'>,
): TimeWindow | null {
  const from = range?.from?.trim()
  const to = range?.to?.trim()
  if (!from || !to) return null
  if (!/^\d{4}-\d{2}-\d{2}/.test(from) || !/^\d{4}-\d{2}-\d{2}/.test(to)) return null
  const fromIso = from.length === 10 ? zonedDayBoundsIso(from, clock.timeZone)?.from ?? null : from
  const toIso = to.length === 10 ? zonedDayBoundsIso(to, clock.timeZone)?.to ?? null : to
  if (!fromIso || !toIso) return null
  const fromMs = Date.parse(fromIso)
  const toMs = Date.parse(toIso)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) return null
  return { from: fromIso, to: toIso }
}

