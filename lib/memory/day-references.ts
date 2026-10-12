/**
 * Deterministic day-reference resolution.
 *
 * The per-turn distillation (`extractMemorySearchKeywords`) asks a cheap LLM to
 * decide whether a turn is retrospective and to resolve any referenced period
 * into an absolute `timeRange`. Small models reliably fumble the *same-day*
 * case: "the mission today" reads as present tense to them, so the whole
 * episodic path (temporal flip, `occurredWithin` window, multi-probe) stays
 * inert on exactly the turn that needs it most. Worse, when a model does emit a
 * range it resolves the calendar in UTC — at 21:44 CDT "today" is already
 * tomorrow in UTC, and the window misses every memory it was meant to catch.
 *
 * This module resolves the common English day references deterministically,
 * against the instance's memory calendar (`lib/memory/memory-calendar.ts`:
 * instance timezone → `QUILLTAP_TIMEZONE` → system). The write side
 * (`resolveWhenPhrase` in `episodic.ts`) uses the same calendar and stamps
 * each phrase inside the window this module returns for it, so "last night"
 * written lands inside "last night" read (bug 212). Never use the `getUTC*`
 * family or bare `Date` local accessors for these boundaries.
 *
 * Pure + I/O-free — no logging, no DB, no LLM — so it is trivially unit-testable
 * and safe to import from the forked job child (same contract as
 * `lib/memory/recall-tags.ts`).
 */

import {
  getMemoryTimeZone,
  startOfZonedDayMs,
  startOfZonedWeekMs,
  zonedTimeOnDayMs,
} from './memory-calendar'

export interface DayReferenceResolution {
  /**
   * Absolute UTC window covering the referenced local calendar period. ISO
   * strings via `toISOString()` — consumers compare with `Date.parse`, so the
   * UTC rendering of a local boundary is exactly right.
   *
   * Only meaningful when {@link pastPointing} is true: callers must NOT apply
   * the window of a future-pointing reference (it is computed and returned for
   * debug logging only).
   */
  timeRange: { from: string; to: string }
  /** True when the reference points at the past (today/yesterday/…), false for future ("tomorrow"). */
  pastPointing: boolean
  /** Which phrase matched — for debug logging and the replay output. */
  matched: string
}

/** Number words the "N days ago" form accepts, alongside digits 1–14. */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
}

/** Largest `N days ago` the lexicon resolves (beyond this, leave it to the LLM). */
const MAX_DAYS_AGO = 14

/**
 * The lexicon as a single ordered alternation. Order matters twice over:
 * longest-first so "day before yesterday" is consumed whole (never re-read as a
 * bare "yesterday"), and the scan resumes after each match so an inner phrase
 * can never win the latest-match tie-break against its own container.
 */
const DAY_REFERENCE_PATTERN = new RegExp(
  '\\b(?:' +
    [
      'day before yesterday',
      'last night',
      'earlier today',
      'this morning',
      'this afternoon',
      'this evening',
      'tonight',
      'yesterday',
      'today',
      `(?:\\d{1,2}|${Object.keys(NUMBER_WORDS).join('|')}) days? ago`,
      'this week',
      'last week',
      'next week',
      'tomorrow',
    ].join('|') +
    ')\\b',
  'gi',
)

/** Local midnight of the day `offsetDays` from the local day containing `d`. */
function startOfLocalDay(d: Date, tz: string, offsetDays = 0): Date {
  return new Date(startOfZonedDayMs(d.getTime(), tz, offsetDays))
}

/** Local wall-clock time on the day `offsetDays` from the local day containing `d`. */
function localTimeOnDay(d: Date, tz: string, offsetDays: number, hours: number): Date {
  return new Date(zonedTimeOnDayMs(d.getTime(), tz, offsetDays, hours))
}

/** Local midnight of the most recent Monday (today, when today is Monday). */
function startOfLocalWeek(d: Date, tz: string, weekOffset = 0): Date {
  return new Date(startOfZonedWeekMs(d.getTime(), tz, weekOffset))
}

function window(from: Date, to: Date): { from: string; to: string } {
  return { from: from.toISOString(), to: to.toISOString() }
}

/** Resolve one matched phrase into its window. */
function resolvePhrase(phrase: string, now: Date, tz: string): DayReferenceResolution | null {
  const p = phrase.toLowerCase().trim()

  // Today and its parts — from local midnight up to the current instant. A
  // sub-day phrase ("this morning") deliberately does NOT narrow the window:
  // memories carry coarse event times, and a too-tight window starves recall.
  if (
    p === 'today' ||
    p === 'earlier today' ||
    p === 'this morning' ||
    p === 'this afternoon' ||
    p === 'this evening' ||
    p === 'tonight'
  ) {
    return { timeRange: window(startOfLocalDay(now, tz), now), pastPointing: true, matched: p }
  }

  if (p === 'last night') {
    return {
      timeRange: window(localTimeOnDay(now, tz, -1, 18), localTimeOnDay(now, tz, 0, 6)),
      pastPointing: true,
      matched: p,
    }
  }

  if (p === 'yesterday') {
    return {
      timeRange: window(startOfLocalDay(now, tz, -1), startOfLocalDay(now, tz)),
      pastPointing: true,
      matched: p,
    }
  }

  if (p === 'day before yesterday') {
    return {
      timeRange: window(startOfLocalDay(now, tz, -2), startOfLocalDay(now, tz, -1)),
      pastPointing: true,
      matched: p,
    }
  }

  if (p === 'this week') {
    return { timeRange: window(startOfLocalWeek(now, tz), now), pastPointing: true, matched: p }
  }

  if (p === 'last week') {
    return {
      timeRange: window(startOfLocalWeek(now, tz, -1), startOfLocalWeek(now, tz)),
      pastPointing: true,
      matched: p,
    }
  }

  // Future references resolve a window too, but purely for the debug log — the
  // merge policy applies a window only when `pastPointing` is true.
  if (p === 'tomorrow') {
    return {
      timeRange: window(startOfLocalDay(now, tz, 1), startOfLocalDay(now, tz, 2)),
      pastPointing: false,
      matched: p,
    }
  }

  if (p === 'next week') {
    return {
      timeRange: window(startOfLocalWeek(now, tz, 1), startOfLocalWeek(now, tz, 2)),
      pastPointing: false,
      matched: p,
    }
  }

  const daysAgo = p.match(/^(\S+) days? ago$/)
  if (daysAgo) {
    const raw = daysAgo[1]
    const n = /^\d{1,2}$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw]
    if (!n || n < 1 || n > MAX_DAYS_AGO) return null
    return {
      timeRange: window(startOfLocalDay(now, tz, -n), startOfLocalDay(now, tz, -n + 1)),
      pastPointing: true,
      matched: p,
    }
  }

  return null
}

/**
 * Scan conversation text for an explicit day reference and resolve it against
 * `now` on the memory calendar (`timeZone`, default the instance's memory
 * timezone). Returns null when no reference found.
 * Later (more recent) matches in the text win over earlier ones — the most
 * recent utterance reflects the turn's current focus, so "we talked about that
 * yesterday, but today…" resolves to today.
 */
export function resolveDayReference(
  text: string,
  now: Date,
  timeZone: string = getMemoryTimeZone(),
): DayReferenceResolution | null {
  if (!text || !Number.isFinite(now.getTime())) return null

  let latest: DayReferenceResolution | null = null
  DAY_REFERENCE_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = DAY_REFERENCE_PATTERN.exec(text)) !== null) {
    const resolved = resolvePhrase(match[0], now, timeZone)
    // An unresolvable match (e.g. "97 days ago") still consumed its span; the
    // previous winner stands rather than being clobbered by a null.
    if (resolved) latest = resolved
    // Zero-length matches are impossible with this pattern, but guard the loop.
    if (match.index === DAY_REFERENCE_PATTERN.lastIndex) DAY_REFERENCE_PATTERN.lastIndex++
  }

  return latest
}
