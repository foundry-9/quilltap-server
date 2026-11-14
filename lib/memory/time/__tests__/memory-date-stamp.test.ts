/**
 * #187 — a date printed into a memory prompt is the instance calendar's day,
 * never the UTC day an ISO string's first ten characters name; and A20 — a
 * zone-less ISO wall time from a model is read on the instance calendar, not
 * the server's system zone.
 */

import { memoryDateStamp, normaliseTimeRange, parseInstantOnCalendar, resolveEventTime } from '../clock'

const CHICAGO = { timeZone: 'America/Chicago' }

describe('memoryDateStamp (#187)', () => {
  it('prints 03:44Z as the previous day on an America/Chicago calendar', () => {
    expect(memoryDateStamp('2026-11-11T03:44:00.000Z', CHICAGO)).toBe('2026-11-10')
  })

  it('prints the same instant as the UTC day on a UTC calendar', () => {
    expect(memoryDateStamp('2026-11-11T03:44:00.000Z', { timeZone: 'UTC' })).toBe('2026-11-11')
  })

  it('reads east of Greenwich forward', () => {
    expect(memoryDateStamp('2026-11-10T22:30:00.000Z', { timeZone: 'Asia/Tokyo' })).toBe('2026-11-11')
  })

  it('is null for an empty or unparseable value', () => {
    expect(memoryDateStamp(null, CHICAGO)).toBeNull()
    expect(memoryDateStamp('', CHICAGO)).toBeNull()
    expect(memoryDateStamp('not a date', CHICAGO)).toBeNull()
  })
})

describe('parseInstantOnCalendar (A20)', () => {
  it('reads a zone-less wall time on the given calendar', () => {
    // 21:00 in Chicago (CST, UTC−6 in November) is 03:00Z the next day.
    expect(new Date(parseInstantOnCalendar('2026-11-10T21:00', 'America/Chicago')!).toISOString()).toBe(
      '2026-11-11T03:00:00.000Z',
    )
  })

  it('leaves a zoned instant as it is', () => {
    expect(new Date(parseInstantOnCalendar('2026-11-10T21:00:00Z', 'America/Chicago')!).toISOString()).toBe(
      '2026-11-10T21:00:00.000Z',
    )
    expect(new Date(parseInstantOnCalendar('2026-11-10T21:00:00+02:00', 'America/Chicago')!).toISOString()).toBe(
      '2026-11-10T19:00:00.000Z',
    )
  })

  it('refuses an impossible date', () => {
    expect(parseInstantOnCalendar('2026-02-30T10:00', 'UTC')).toBeNull()
  })
})

describe('the clock reads zone-less model times on the calendar (A20)', () => {
  it('resolveEventTime stamps a zone-less datetime on the instance calendar', () => {
    const anchor = Date.parse('2026-11-12T00:00:00Z')
    expect(resolveEventTime('2026-11-10T21:00', anchor, CHICAGO).occurredAt).toBe('2026-11-11T03:00:00.000Z')
  })

  it('normaliseTimeRange returns UTC instants for zone-less datetimes', () => {
    expect(normaliseTimeRange({ from: '2026-11-10T08:00', to: '2026-11-10T20:00' }, CHICAGO)).toEqual({
      from: '2026-11-10T14:00:00.000Z',
      to: '2026-11-11T02:00:00.000Z',
    })
  })
})
