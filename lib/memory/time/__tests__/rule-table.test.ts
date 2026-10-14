/**
 * The day-reference table drives both directions (memory refactor §3.3,
 * Phase A): for every past phrase it knows, the write side stamps the START
 * of the window the read side returns, on one fixed calendar. Pinned here on
 * America/Chicago, across a DST change, with closed windows so a midnight
 * stamp belongs to one day only.
 */

import {
  clockFor,
  DAY_REFERENCE_TABLE,
  resolveEventTime,
  resolveReferenceWindow,
  normaliseTimeRange,
} from '..'
import { resetMemoryTimeZoneCacheForTests } from '../calendar'

const TZ = 'America/Chicago'

/** One phrase per past rule (and every alternative of the "today" rule). */
const PAST_PHRASES = [
  'day before yesterday',
  'last night',
  'earlier today',
  'this morning',
  'this afternoon',
  'this evening',
  'tonight',
  'today',
  'yesterday',
  '1 day ago',
  '3 days ago',
  'eleven days ago',
  'fourteen days ago',
  'this week',
  'last week',
]

const ANCHORS = [
  '2026-10-12T19:00:00.000Z', // Monday 14:00 CDT
  '2026-11-02T05:30:00.000Z', // Sunday 23:30 CST, just after the DST change
  '2026-03-09T04:00:00.000Z', // Sunday 23:00 CDT, the night DST began
  '2026-07-21T15:00:00.000Z', // Tuesday 10:00 CDT
]

describe('DAY_REFERENCE_TABLE — both directions', () => {
  it('names every past phrase above', () => {
    const covered = new Set(
      PAST_PHRASES.map(p => DAY_REFERENCE_TABLE.find(r => new RegExp(`^(?:${r.pattern})$`, 'i').test(p))?.name),
    )
    expect(covered.has(undefined)).toBe(false)
    const pastRules = DAY_REFERENCE_TABLE.filter(r => r.name !== 'tomorrow' && r.name !== 'next week').map(r => r.name)
    expect([...covered].sort()).toEqual([...pastRules].sort())
  })

  it.each(ANCHORS.flatMap(anchor => PAST_PHRASES.map(phrase => [anchor, phrase] as const)))(
    'at %s, "%s" written is the start of "%s" read',
    (anchor, phrase) => {
      const nowMs = Date.parse(anchor)
      const clock = { timeZone: TZ, nowMs }
      const written = resolveEventTime(phrase, nowMs, clock)
      const read = resolveReferenceWindow(`we talked about it ${phrase}, remember`, clock)
      expect(read).not.toBeNull()
      expect(read!.pastPointing).toBe(true)
      expect(written.occurredAt).toBe(read!.timeRange.from)
      expect(written.window).toEqual(read!.timeRange)
      const t = Date.parse(written.occurredAt!)
      expect(t).toBeGreaterThanOrEqual(Date.parse(read!.timeRange.from))
      expect(t).toBeLessThanOrEqual(Date.parse(read!.timeRange.to))
    },
  )

  it('future references read as a window but never as an event time', () => {
    const clock = { timeZone: TZ, nowMs: Date.parse(ANCHORS[0]) }
    for (const phrase of ['tomorrow', 'next week']) {
      expect(resolveReferenceWindow(`see you ${phrase}`, clock)!.pastPointing).toBe(false)
      expect(resolveEventTime(phrase, clock.nowMs, clock)).toEqual({ occurredAt: null, window: null })
    }
  })

  it('closes each window one millisecond before the next boundary, so midnight belongs to one day', () => {
    const clock = { timeZone: TZ, nowMs: Date.parse(ANCHORS[0]) }
    const yesterday = resolveReferenceWindow('yesterday', clock)!.timeRange
    const twoDaysAgo = resolveReferenceWindow('2 days ago', clock)!.timeRange
    // A memory written as "yesterday" (its local midnight) is not in "2 days ago".
    const stamped = Date.parse(resolveEventTime('yesterday', clock.nowMs, clock).occurredAt!)
    expect(stamped).toBeGreaterThan(Date.parse(twoDaysAgo.to))
    expect(Date.parse(yesterday.from) - Date.parse(twoDaysAgo.to)).toBe(1)
  })
})

describe('write-only rules', () => {
  const nowMs = Date.parse('2026-10-12T19:00:00.000Z') // Monday 14:00 CDT
  const clock = { timeZone: TZ }

  it.each([
    ['2026-07-14', '2026-07-14T05:00:00.000Z'],
    ['2026-07-14T09:30:00.000Z', '2026-07-14T09:30:00.000Z'],
    ['October 1', '2026-10-01T05:00:00.000Z'],
    ['December 25', '2025-12-25T06:00:00.000Z'],
    ['two weeks ago', '2026-09-28T05:00:00.000Z'],
    ['a couple of days ago', '2026-10-10T05:00:00.000Z'],
    ['about 3 months back', '2026-07-14T05:00:00.000Z'],
    ['last Friday', '2026-10-09T05:00:00.000Z'],
    ['the other day', '2026-10-10T05:00:00.000Z'],
    ['20 days ago', '2026-09-22T05:00:00.000Z'],
  ])('%s → %s', (phrase, expected) => {
    expect(resolveEventTime(phrase, nowMs, clock).occurredAt).toBe(expected)
  })

  it('the anchor-moment phrases keep the anchor', () => {
    expect(resolveEventTime('just now', nowMs, clock).occurredAt).toBe(new Date(nowMs).toISOString())
  })

  it('unknown phrases resolve to nothing', () => {
    expect(resolveEventTime('the third night at sea', nowMs, clock)).toEqual({ occurredAt: null, window: null })
    expect(resolveEventTime('', nowMs, clock)).toEqual({ occurredAt: null, window: null })
    expect(resolveEventTime('yesterday', Number.NaN, clock)).toEqual({ occurredAt: null, window: null })
  })
})

describe('normaliseTimeRange — the classifier\'s date-only ranges are local days', () => {
  it('widens date-only bounds to the local day and passes datetimes through', () => {
    expect(normaliseTimeRange({ from: '2026-10-11', to: '2026-10-11' }, { timeZone: TZ })).toEqual({
      from: '2026-10-11T05:00:00.000Z',
      to: '2026-10-12T04:59:59.999Z',
    })
    expect(normaliseTimeRange({ from: '2026-10-11T00:00:00.000Z', to: '2026-10-12' }, { timeZone: TZ })).toEqual({
      from: '2026-10-11T00:00:00.000Z',
      to: '2026-10-13T04:59:59.999Z',
    })
  })

  it('refuses unusable or inverted ranges', () => {
    expect(normaliseTimeRange({ from: '2026-10-12', to: '2026-10-11' }, { timeZone: TZ })).toBeNull()
    expect(normaliseTimeRange({ from: 'last week', to: '2026-10-11' }, { timeZone: TZ })).toBeNull()
    expect(normaliseTimeRange({ from: '2026-02-30', to: '2026-03-01' }, { timeZone: TZ })).toBeNull()
    expect(normaliseTimeRange(null, { timeZone: TZ })).toBeNull()
  })
})

describe('clockFor — one calendar per instance', () => {
  const saved = process.env.QUILLTAP_TIMEZONE
  afterEach(() => {
    if (saved === undefined) delete process.env.QUILLTAP_TIMEZONE
    else process.env.QUILLTAP_TIMEZONE = saved
    resetMemoryTimeZoneCacheForTests()
  })

  it('takes the instance zone, then QUILLTAP_TIMEZONE, and the chat timeline mode only', () => {
    resetMemoryTimeZoneCacheForTests()
    process.env.QUILLTAP_TIMEZONE = 'Europe/Paris'
    expect(clockFor({ timelineMode: 'narrative' }, { timeZone: TZ }, 5)).toEqual({ timeZone: TZ, nowMs: 5, timelineMode: 'narrative' })
    expect(clockFor(null, {}, 5)).toEqual({ timeZone: 'Europe/Paris', nowMs: 5, timelineMode: 'realtime' })
    expect(clockFor({ timelineMode: null }, { timeZone: 'Not/AZone' }, 5).timeZone).toBe('Europe/Paris')
  })
})
