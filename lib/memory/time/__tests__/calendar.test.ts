/**
 * Bug 212 — one calendar per instance for event time.
 *
 * The write side (`resolveWhenPhrase`) and the read side (`resolveDayReference`)
 * resolve every shared phrase on the same calendar, so a memory written from a
 * phrase lands inside the window the same phrase asks for on read. The clock
 * is pinned to America/Chicago (UTC−5 in October), where the old UTC-midnight
 * write side missed "last night" and "yesterday".
 */

import { resolveWhenPhrase } from '../clock'
import { resolveDayReference } from '../clock'
import {
  getMemoryTimeZone,
  resetMemoryTimeZoneCacheForTests,
  setCachedInstanceTimeZone,
  startOfZonedDayMs,
  zonedDayBoundsIso,
  zonedTimeToUtcMs,
} from '../calendar'

const TZ = 'America/Chicago'

/** The read side's phrases that point at the past (the shared rule table). */
const SHARED_PHRASES = [
  'today',
  'earlier today',
  'this morning',
  'this afternoon',
  'this evening',
  'tonight',
  'last night',
  'yesterday',
  'day before yesterday',
  'two days ago',
  '3 days ago',
  'this week',
  'last week',
]

/** Anchors spread across the day, a week boundary and a DST change (Nov 1, 2026). */
const ANCHORS = [
  '2026-10-12T19:00:00.000Z', // 14:00 CDT Monday — the bug's example
  '2026-10-12T07:30:00.000Z', // 02:30 CDT Monday — after midnight, before 06:00
  '2026-10-13T04:30:00.000Z', // 23:30 CDT Monday — UTC already Tuesday
  '2026-10-18T16:00:00.000Z', // 11:00 CDT Sunday — end of the local week
  '2026-11-02T15:00:00.000Z', // 09:00 CST Monday — the day after DST ends
]

describe('memory calendar — write lands inside read (bug 212)', () => {
  for (const anchor of ANCHORS) {
    for (const phrase of SHARED_PHRASES) {
      it(`"${phrase}" at ${anchor}`, () => {
        const written = resolveWhenPhrase(phrase, anchor, TZ)
        const read = resolveDayReference(`Do you remember ${phrase}?`, new Date(anchor), TZ)
        expect(written).not.toBeNull()
        expect(read).not.toBeNull()
        expect(read!.pastPointing).toBe(true)
        const t = Date.parse(written!)
        expect(t).toBeGreaterThanOrEqual(Date.parse(read!.timeRange.from))
        expect(t).toBeLessThanOrEqual(Date.parse(read!.timeRange.to))
      })
    }
  }

  it('reproduces the bug report: "last night" at 14:00 CDT', () => {
    const anchor = '2026-10-12T19:00:00.000Z'
    // 18:00 CDT on October 11 — not the old 2026-10-11T00:00Z (19:00 on the 10th).
    expect(resolveWhenPhrase('last night', anchor, TZ)).toBe('2026-10-11T23:00:00.000Z')
    expect(resolveDayReference('last night', new Date(anchor), TZ)!.timeRange).toEqual({
      from: '2026-10-11T23:00:00.000Z',
      to: '2026-10-12T10:59:59.999Z',
    })
    // "yesterday" is local midnight, not UTC midnight.
    expect(resolveWhenPhrase('yesterday', anchor, TZ)).toBe('2026-10-11T05:00:00.000Z')
  })

  it('stamps ISO dates and named dates at local midnight', () => {
    const anchor = '2026-10-12T19:00:00.000Z'
    expect(resolveWhenPhrase('2026-07-14', anchor, TZ)).toBe('2026-07-14T05:00:00.000Z')
    expect(resolveWhenPhrase('July 14', anchor, TZ)).toBe('2026-07-14T05:00:00.000Z')
    // A full datetime is kept as given.
    expect(resolveWhenPhrase('2026-07-14T09:30:00Z', anchor, TZ)).toBe('2026-07-14T09:30:00.000Z')
  })

  it('resolves "last <weekday>" on the local weekday', () => {
    // 23:30 CDT Monday Oct 12 is already Tuesday in UTC; last Monday is Oct 5 local.
    expect(resolveWhenPhrase('last Monday', '2026-10-13T04:30:00.000Z', TZ)).toBe('2026-10-05T05:00:00.000Z')
  })
})

describe('memory calendar — classifier date-only bounds are local days', () => {
  it('widens a date to its local day', () => {
    expect(zonedDayBoundsIso('2026-10-11', TZ)).toEqual({
      from: '2026-10-11T05:00:00.000Z',
      to: '2026-10-12T04:59:59.999Z',
    })
  })

  it('handles a 25-hour day (DST ends Nov 1, 2026)', () => {
    expect(zonedDayBoundsIso('2026-11-01', TZ)).toEqual({
      from: '2026-11-01T05:00:00.000Z',
      to: '2026-11-02T05:59:59.999Z',
    })
  })

  it('rejects impossible dates', () => {
    expect(zonedDayBoundsIso('2026-02-30', TZ)).toBeNull()
    expect(zonedDayBoundsIso('yesterday', TZ)).toBeNull()
  })

  it('round-trips local wall time', () => {
    expect(new Date(zonedTimeToUtcMs(2026, 9, 11, 18, TZ)).toISOString()).toBe('2026-10-11T23:00:00.000Z')
    expect(new Date(startOfZonedDayMs(Date.parse('2026-10-12T03:00:00.000Z'), TZ)).toISOString()).toBe(
      '2026-10-11T05:00:00.000Z',
    )
  })
})

describe('memory calendar — timezone resolution', () => {
  const savedEnv = process.env.QUILLTAP_TIMEZONE
  afterEach(() => {
    resetMemoryTimeZoneCacheForTests()
    if (savedEnv === undefined) delete process.env.QUILLTAP_TIMEZONE
    else process.env.QUILLTAP_TIMEZONE = savedEnv
  })

  it('prefers the instance timezone, then QUILLTAP_TIMEZONE, then the system zone', () => {
    delete process.env.QUILLTAP_TIMEZONE
    expect(getMemoryTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    process.env.QUILLTAP_TIMEZONE = 'Asia/Tokyo'
    expect(getMemoryTimeZone()).toBe('Asia/Tokyo')
    setCachedInstanceTimeZone('America/Chicago')
    expect(getMemoryTimeZone()).toBe('America/Chicago')
  })

  it('ignores an invalid zone at any level', () => {
    process.env.QUILLTAP_TIMEZONE = 'Not/AZone'
    setCachedInstanceTimeZone('Also/Bogus')
    expect(getMemoryTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('drives the default calendar of both resolvers', () => {
    setCachedInstanceTimeZone('America/Chicago')
    const anchor = '2026-10-12T19:00:00.000Z'
    expect(resolveWhenPhrase('last night', anchor)).toBe('2026-10-11T23:00:00.000Z')
    expect(resolveDayReference('last night', new Date(anchor))!.timeRange.from).toBe('2026-10-11T23:00:00.000Z')
  })
})
