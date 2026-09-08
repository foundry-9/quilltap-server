/**
 * Character progressions — the engine.
 *
 * The five functions everything else in the feature is plumbing around, tested
 * against a held clock. The interesting parts are the ones a reader would get
 * wrong from the prose alone: what `elapsed` counts in each of the three
 * states, that `percent` is uncapped for Pascal but clamped for display, and
 * the cadence ladder, whose rules are ordered and whose FIRST match wins.
 */

import {
  UNIT_MS,
  deriveProgression,
  defaultInProgressTemplate,
  flattenProgressions,
  formatSpan,
  formatSpanWhole,
  inferIncrement,
  parseProgressions,
  parseReportPeriodMs,
  progressionPlaceholders,
  renderProgressionReport,
  shouldReportProgression,
} from '@/lib/progressions/engine'
import { ProgressionSchema, type Progression } from '@/lib/progressions/schema'

/** A parsed progression, defaults filled, so tests never hand-build a partial. */
function progression(overrides: Record<string, unknown> = {}): Progression {
  return ProgressionSchema.parse({
    name: 'Cannon recharge',
    startTime: '2026-09-08T14:00:00Z',
    endTime: '2026-09-08T14:10:00Z',
    timeIncrement: 'minute',
    ...overrides,
  })
}

const at = (iso: string) => Date.parse(iso)

const CANNON_START = at('2026-09-08T14:00:00Z')

describe('formatSpan', () => {
  it('renders whole units plus a remainder in the next finer unit', () => {
    expect(formatSpan(2 * UNIT_MS.minute + 10 * UNIT_MS.second, 'minute')).toBe('2 minutes, 10 seconds')
    expect(formatSpan(20 * UNIT_MS.week + 3 * UNIT_MS.day, 'week')).toBe('20 weeks, 3 days')
  })

  it('drops the remainder when the span is an exact multiple', () => {
    expect(formatSpan(3 * UNIT_MS.hour, 'hour')).toBe('3 hours')
    expect(formatSpan(UNIT_MS.day, 'day')).toBe('1 day')
  })

  it('speaks only the finer unit when the whole count is zero', () => {
    expect(formatSpan(12 * UNIT_MS.second, 'minute')).toBe('12 seconds')
    expect(formatSpan(5 * UNIT_MS.hour, 'day')).toBe('5 hours')
  })

  it('renders zero in the named unit when there is nothing to spend on a finer one', () => {
    expect(formatSpan(0, 'minute')).toBe('0 minutes')
    expect(formatSpan(0, 'week')).toBe('0 weeks')
  })

  it('singularises exactly one of either unit', () => {
    expect(formatSpan(UNIT_MS.minute + UNIT_MS.second, 'minute')).toBe('1 minute, 1 second')
  })

  it('has no finer unit below second, so a sub-second span is 0 seconds', () => {
    expect(formatSpan(999, 'second')).toBe('0 seconds')
    expect(formatSpan(1500, 'second')).toBe('1 second')
  })

  it('uses the fixed-length month and year — 30.436875 and 365.2425 days', () => {
    expect(UNIT_MS.month).toBe(Math.round(30.436875 * UNIT_MS.day))
    expect(UNIT_MS.year).toBe(Math.round(365.2425 * UNIT_MS.day))
    expect(formatSpan(UNIT_MS.year + UNIT_MS.month, 'year')).toBe('1 year, 1 month')
    expect(formatSpan(UNIT_MS.month + 2 * UNIT_MS.day, 'month')).toBe('1 month, 2 days')
  })

  it('covers every unit without a remainder', () => {
    const units = ['second', 'minute', 'hour', 'day', 'week', 'month', 'year'] as const
    for (const unit of units) expect(formatSpan(2 * UNIT_MS[unit], unit)).toBe(`2 ${unit}s`)
  })

  it('takes the magnitude of a negative input rather than rendering a minus sign', () => {
    expect(formatSpan(-3 * UNIT_MS.hour, 'hour')).toBe('3 hours')
  })

  it('renders zero for a non-finite input rather than NaN', () => {
    expect(formatSpan(NaN, 'minute')).toBe('0 minutes')
    expect(formatSpan(Infinity, 'minute')).toBe('0 minutes')
  })
})

describe('formatSpanWhole', () => {
  it('drops the finer unit entirely', () => {
    expect(formatSpanWhole(20 * UNIT_MS.week + 3 * UNIT_MS.day, 'week')).toBe('20 weeks')
    expect(formatSpanWhole(12 * UNIT_MS.second, 'minute')).toBe('0 minutes')
  })
})

describe('deriveProgression', () => {
  const p = progression()

  it('is pending before the start, and counts down to it', () => {
    const d = deriveProgression('cannon', p, CANNON_START - 2 * UNIT_MS.minute)
    expect(d.state).toBe('pending')
    expect(d.started).toBe(false)
    expect(d.complete).toBe(false)
    expect(d.elapsedMs).toBe(0)
    expect(d.elapsed).toBe('0 minutes')
    expect(d.remaining).toBe('2 minutes')
  })

  it('is active exactly at the start instant, with nothing elapsed', () => {
    const d = deriveProgression('cannon', p, CANNON_START)
    expect(d.state).toBe('active')
    expect(d.started).toBe(true)
    expect(d.percent).toBe(0)
    expect(d.remaining).toBe('10 minutes')
  })

  it('reports elapsed, remaining and percent mid-span', () => {
    const d = deriveProgression('cannon', p, CANNON_START + 2 * UNIT_MS.minute + 10 * UNIT_MS.second)
    expect(d.elapsed).toBe('2 minutes, 10 seconds')
    expect(d.remaining).toBe('7 minutes, 50 seconds')
    expect(Math.round(d.percent)).toBe(22)
  })

  it('is complete exactly at the end instant', () => {
    const d = deriveProgression('cannon', p, CANNON_START + 10 * UNIT_MS.minute)
    expect(d.state).toBe('complete')
    expect(d.complete).toBe(true)
    expect(d.percent).toBe(100)
    expect(d.remainingMs).toBe(0)
  })

  it('counts elapsed from the END once complete — "3 days past due"', () => {
    const pregnancy = progression({
      startTime: '2026-08-01T00:00:00Z',
      endTime: '2027-05-01T00:00:00Z',
      timeIncrement: 'week',
    })
    const d = deriveProgression('pregnancy', pregnancy, at('2027-05-04T00:00:00Z'))
    expect(d.state).toBe('complete')
    expect(d.elapsed).toBe('3 days')
  })

  it('leaves percent uncapped for Pascal but clamps it for display', () => {
    const over = deriveProgression('cannon', p, CANNON_START + 20 * UNIT_MS.minute)
    expect(over.percent).toBe(200)
    expect(over.percentClamped).toBe(100)

    const under = deriveProgression('cannon', p, CANNON_START - 10 * UNIT_MS.minute)
    expect(under.percent).toBe(-100)
    expect(under.percentClamped).toBe(0)
  })

  it('caps elapsedMs at the span but lets remainingMs go negative when overdue', () => {
    const d = deriveProgression('cannon', p, CANNON_START + 15 * UNIT_MS.minute)
    expect(d.elapsedMs).toBe(10 * UNIT_MS.minute)
    expect(d.remainingMs).toBe(-5 * UNIT_MS.minute)
  })

  it('derives the current quantity from the clamped percent', () => {
    const q = progression({ quantity: { total: 1.0, unit: 'MJ', precision: 1 } })
    expect(deriveProgression('cannon', q, CANNON_START + 3 * UNIT_MS.minute).quantityCurrent).toBeCloseTo(0.3)
    expect(deriveProgression('cannon', q, CANNON_START + 30 * UNIT_MS.minute).quantityCurrent).toBe(1.0)
    expect(deriveProgression('cannon', q, CANNON_START - UNIT_MS.minute).quantityCurrent).toBe(0)
  })

  it('omits quantityCurrent entirely when the progression carries no quantity', () => {
    expect(deriveProgression('cannon', p, CANNON_START).quantityCurrent).toBeUndefined()
  })

  it('carries the id and display name through', () => {
    const d = deriveProgression('cannon', p, CANNON_START)
    expect(d.id).toBe('cannon')
    expect(d.name).toBe('Cannon recharge')
  })
})

describe('shouldReportProgression — the cadence ladder', () => {
  const report = (p: Progression, nowMs: number, lastTurnMs: number | null) =>
    shouldReportProgression(p, deriveProgression('cannon', p, nowMs), lastTurnMs)

  it('rule 1: a character who has never spoken here hears everything', () => {
    const p = progression({ reportFrequency: '1h' })
    expect(report(p, CANNON_START + UNIT_MS.minute, null)).toEqual({ report: true, reason: 'first' })
  })

  it('rule 2: an updatedAt newer than the last turn beats the cadence', () => {
    const p = progression({ reportFrequency: '1h', updatedAt: '2026-09-08T14:05:00Z' })
    // Same clock hour as the last turn, so the period bucket alone would decline.
    const result = report(p, at('2026-09-08T14:06:00Z'), at('2026-09-08T14:04:00Z'))
    expect(result).toEqual({ report: true, reason: 'updated' })
  })

  it('rule 2: an updatedAt OLDER than the last turn does not force anything', () => {
    const p = progression({ reportFrequency: '1h', updatedAt: '2026-09-08T14:01:00Z' })
    expect(report(p, at('2026-09-08T14:06:00Z'), at('2026-09-08T14:04:00Z'))).toEqual({
      report: false,
      reason: 'skip',
    })
  })

  it('rule 2: an unparseable updatedAt is simply ignored', () => {
    const p = progression({ reportFrequency: '1h' })
    const withJunk = { ...p, updatedAt: 'sometime last Tuesday' } as Progression
    expect(report(withJunk, at('2026-09-08T14:06:00Z'), at('2026-09-08T14:04:00Z')).report).toBe(false)
  })

  it('rule 3: pending → active is a transition, whatever the cadence says', () => {
    const p = progression({ reportFrequency: '1h' })
    expect(report(p, CANNON_START + UNIT_MS.second, CANNON_START - UNIT_MS.second)).toEqual({
      report: true,
      reason: 'transition',
    })
  })

  it('rule 3: active → complete is the turn that reports a completion', () => {
    const p = progression({ reportFrequency: '1h', onComplete: 'once' })
    expect(report(p, CANNON_START + 11 * UNIT_MS.minute, CANNON_START + 9 * UNIT_MS.minute)).toEqual({
      report: true,
      reason: 'transition',
    })
  })

  it('rule 4: onComplete "once" goes silent on every turn after the transition', () => {
    const p = progression({ onComplete: 'once' })
    expect(report(p, CANNON_START + 12 * UNIT_MS.minute, CANNON_START + 11 * UNIT_MS.minute)).toEqual({
      report: false,
      reason: 'silenced',
    })
  })

  it('rule 4: onComplete "keep" goes on reporting on its own cadence', () => {
    const p = progression({ onComplete: 'keep' })
    expect(report(p, CANNON_START + 12 * UNIT_MS.minute, CANNON_START + 11 * UNIT_MS.minute)).toEqual({
      report: true,
      reason: 'turn',
    })
  })

  it('rule 5: "turn" reports on every prompted turn', () => {
    const p = progression()
    expect(report(p, CANNON_START + UNIT_MS.minute, CANNON_START + 59 * UNIT_MS.second)).toEqual({
      report: true,
      reason: 'turn',
    })
  })

  it('rule 6: "increment" reports only when the whole-unit count ticks over', () => {
    const p = progression({ reportFrequency: 'increment' })
    // 90 s → 100 s elapsed: still minute 1.
    expect(report(p, CANNON_START + 100 * UNIT_MS.second, CANNON_START + 90 * UNIT_MS.second)).toEqual({
      report: false,
      reason: 'skip',
    })
    // 110 s → 130 s elapsed: minute 1 → minute 2.
    expect(report(p, CANNON_START + 130 * UNIT_MS.second, CANNON_START + 110 * UNIT_MS.second)).toEqual({
      report: true,
      reason: 'increment',
    })
  })

  it('rule 6: "increment" measures elapsed-INTO-span, not wall clock', () => {
    // A pregnancy speaking in weeks: two turns 20 minutes apart, same week.
    const p = progression({
      startTime: '2026-08-01T00:00:00Z',
      endTime: '2027-05-01T00:00:00Z',
      timeIncrement: 'week',
      reportFrequency: 'increment',
    })
    expect(report(p, at('2026-12-01T12:00:00Z'), at('2026-12-01T11:40:00Z')).report).toBe(false)
    expect(report(p, at('2026-12-08T12:00:00Z'), at('2026-12-01T11:40:00Z'))).toEqual({
      report: true,
      reason: 'increment',
    })
  })

  it('rule 7: a period cadence buckets the WALL clock, epoch-anchored', () => {
    // A span still running at both instants, so rule 3 never preempts rule 7.
    const p = progression({ reportFrequency: '1h', endTime: '2026-09-09T14:00:00Z' })
    // 14:04 → 14:59: same clock hour.
    expect(report(p, at('2026-09-08T14:59:00Z'), at('2026-09-08T14:04:00Z'))).toEqual({
      report: false,
      reason: 'skip',
    })
    // 14:59 → 15:01: the bucket edge is crossed after two minutes.
    expect(report(p, at('2026-09-08T15:01:00Z'), at('2026-09-08T14:59:00Z'))).toEqual({
      report: true,
      reason: 'period',
    })
  })

  it('rule 7: 55 minutes inside one hour bucket still declines — the bucket is not a stopwatch', () => {
    const p = progression({ reportFrequency: '1h', endTime: '2026-09-09T14:00:00Z' })
    expect(report(p, at('2026-09-08T14:58:00Z'), at('2026-09-08T14:03:00Z')).report).toBe(false)
  })

  it('rule 7: a 30s cadence crosses a bucket edge in a second', () => {
    const p = progression({ reportFrequency: '30s' })
    expect(report(p, at('2026-09-08T14:00:29Z'), at('2026-09-08T14:00:01Z')).report).toBe(false)
    expect(report(p, at('2026-09-08T14:00:30Z'), at('2026-09-08T14:00:29Z'))).toEqual({
      report: true,
      reason: 'period',
    })
  })

  it('reports "first" for a non-finite last turn as well as a null one', () => {
    expect(report(progression({ reportFrequency: '1h' }), CANNON_START, NaN).reason).toBe('first')
  })
})

describe('parseReportPeriodMs', () => {
  it('converts each period unit', () => {
    expect(parseReportPeriodMs('30s')).toBe(30 * UNIT_MS.second)
    expect(parseReportPeriodMs('5m')).toBe(5 * UNIT_MS.minute)
    expect(parseReportPeriodMs('1h')).toBe(UNIT_MS.hour)
    expect(parseReportPeriodMs('2d')).toBe(2 * UNIT_MS.day)
    expect(parseReportPeriodMs('3w')).toBe(3 * UNIT_MS.week)
  })

  it('returns null for the two words and for junk', () => {
    for (const value of ['turn', 'increment', '', '0h', 'hourly']) {
      expect(parseReportPeriodMs(value)).toBeNull()
    }
  })
})

describe('renderProgressionReport', () => {
  it('renders the spec\u2019s cannon line from the flags alone', () => {
    const p = progression({ quantity: { total: 1.0, unit: 'MJ', precision: 1 } })
    const nowMs = CANNON_START + 2 * UNIT_MS.minute + 10 * UNIT_MS.second
    expect(renderProgressionReport(p, deriveProgression('cannon', p, nowMs))).toBe(
      'Cannon recharge: 2 minutes, 10 seconds elapsed, 7 minutes, 50 seconds remaining, 22% complete (0.2/1.0 MJ).'
    )
  })

  it('omits the percentage when percentageReport is off', () => {
    const p = progression({ percentageReport: false })
    const line = renderProgressionReport(p, deriveProgression('cannon', p, CANNON_START + UNIT_MS.minute))
    expect(line).toBe('Cannon recharge: 1 minute elapsed, 9 minutes remaining.')
    expect(line).not.toContain('%')
  })

  it('prefixes the description as its own sentence', () => {
    const p = progression({ description: 'The gun is charging.', percentageReport: false })
    expect(renderProgressionReport(p, deriveProgression('cannon', p, CANNON_START + UNIT_MS.minute))).toBe(
      'The gun is charging. Cannon recharge: 1 minute elapsed, 9 minutes remaining.'
    )
  })

  it('renders the pregnancy example through a custom template', () => {
    const p = progression({
      name: 'Pregnancy',
      description: 'You are carrying a child.',
      startTime: '2026-08-01T00:00:00Z',
      endTime: '2027-05-01T00:00:00Z',
      timeIncrement: 'week',
      reportTemplate: '{{description}} You are {{elapsedWhole}} along; due in {{remaining}}.',
    })
    const d = deriveProgression('pregnancy', p, at('2026-12-22T00:00:00Z'))
    expect(renderProgressionReport(p, d)).toBe(
      'You are carrying a child. You are 20 weeks along; due in 18 weeks, 4 days.'
    )
  })

  it('leaves an unknown placeholder exactly as written', () => {
    const p = progression({ reportTemplate: '{{name}} at {{trimester}}.' })
    expect(renderProgressionReport(p, deriveProgression('cannon', p, CANNON_START + UNIT_MS.minute))).toBe(
      'Cannon recharge at {{trimester}}.'
    )
  })

  it('renders {{description}} as an empty string when there is no description', () => {
    const p = progression({ reportTemplate: '[{{description}}]' })
    expect(renderProgressionReport(p, deriveProgression('cannon', p, CANNON_START + UNIT_MS.minute))).toBe('[]')
  })

  it('renders {{quantity}} as an empty string when there is no quantity block', () => {
    const p = progression({ reportTemplate: '[{{quantity}}]' })
    expect(renderProgressionReport(p, deriveProgression('cannon', p, CANNON_START + UNIT_MS.minute))).toBe('[]')
  })

  it('uses the fixed "begins in" wording before the start, ignoring the template', () => {
    const p = progression({ reportTemplate: 'never seen' })
    expect(renderProgressionReport(p, deriveProgression('cannon', p, CANNON_START - 90 * UNIT_MS.second))).toBe(
      'Cannon recharge: begins in 1 minute, 30 seconds.'
    )
  })

  it('uses the fixed completion wording after the end, ignoring the template', () => {
    const p = progression({ reportTemplate: 'never seen' })
    expect(renderProgressionReport(p, deriveProgression('cannon', p, CANNON_START + 13 * UNIT_MS.minute))).toBe(
      'Cannon recharge: complete; 3 minutes since it finished.'
    )
  })

  it('honours the quantity precision on both sides of the slash', () => {
    const p = progression({
      quantity: { total: 1, unit: 'MJ', precision: 3 },
      reportTemplate: '{{quantity}}',
    })
    expect(renderProgressionReport(p, deriveProgression('cannon', p, CANNON_START + 5 * UNIT_MS.minute))).toBe(
      '0.500/1.000 MJ'
    )
  })
})

describe('progressionPlaceholders', () => {
  const p = progression({ quantity: { total: 1.0, unit: 'MJ', precision: 1 } })
  const d = deriveProgression('cannon', p, CANNON_START + 5 * UNIT_MS.minute)

  it('offers every documented placeholder', () => {
    expect(Object.keys(progressionPlaceholders(p, d)).sort()).toEqual([
      'description',
      'elapsed',
      'elapsedWhole',
      'end',
      'increment',
      'name',
      'percent',
      'quantity',
      'remaining',
      'remainingWhole',
      'start',
    ])
  })

  it('rounds percent to a whole number', () => {
    expect(progressionPlaceholders(p, d).percent).toBe('50')
  })

  it('names the increment unit as a bare word', () => {
    expect(progressionPlaceholders(p, d).increment).toBe('minute')
  })

  it('renders {{start}} with a time of day for a sub-day increment', () => {
    expect(progressionPlaceholders(p, d, { timezone: 'UTC' }).start).toMatch(/\d:\d\d/)
  })

  it('renders {{start}} as a date alone for a day-or-coarser increment', () => {
    const weekly = progression({ timeIncrement: 'week', endTime: '2026-11-08T14:00:00Z' })
    const wd = deriveProgression('p', weekly, CANNON_START + UNIT_MS.day)
    expect(progressionPlaceholders(weekly, wd, { timezone: 'UTC' }).start).not.toMatch(/\d:\d\d/)
  })

  it('falls back to the host timezone rather than throwing on an unresolvable one', () => {
    expect(progressionPlaceholders(p, d, { timezone: 'Mars/Olympus_Mons' }).start).not.toBe('')
  })
})

describe('defaultInProgressTemplate', () => {
  it('composes the sentence from the flags', () => {
    expect(defaultInProgressTemplate(progression({ percentageReport: false }))).toBe(
      '{{name}}: {{elapsed}} elapsed, {{remaining}} remaining.'
    )
    expect(defaultInProgressTemplate(progression())).toBe(
      '{{name}}: {{elapsed}} elapsed, {{remaining}} remaining, {{percent}}% complete.'
    )
    expect(defaultInProgressTemplate(progression({ quantity: { total: 1, unit: 'MJ' } }))).toBe(
      '{{name}}: {{elapsed}} elapsed, {{remaining}} remaining, {{percent}}% complete ({{quantity}}).'
    )
  })
})

describe('parseProgressions', () => {
  const VALID = {
    name: 'Cannon recharge',
    startTime: '2026-09-08T14:00:00Z',
    endTime: '2026-09-08T14:10:00Z',
    timeIncrement: 'minute',
  }

  it('reads the reserved key off a metadata object', () => {
    expect(Object.keys(parseProgressions({ faction: 'Ordo Aurum', progressions: { cannon: VALID } }))).toEqual([
      'cannon',
    ])
  })

  it('treats an absent key as "none"', () => {
    expect(parseProgressions({ faction: 'Ordo Aurum' })).toEqual({})
  })

  it('treats null, undefined, an array and a primitive metadata as "none"', () => {
    for (const metadata of [null, undefined, [], 'text', 42]) {
      expect(parseProgressions(metadata)).toEqual({})
    }
  })

  it('drops one invalid entry and keeps the rest', () => {
    const issues: Array<[string, string]> = []
    const parsed = parseProgressions(
      { progressions: { cannon: VALID, broken: { ...VALID, endTime: '2026-09-08T13:00:00Z' } } },
      (id, issue) => issues.push([id, issue])
    )
    expect(Object.keys(parsed)).toEqual(['cannon'])
    expect(issues).toHaveLength(1)
    expect(issues[0][0]).toBe('broken')
    expect(issues[0][1]).toContain('strictly after startTime')
  })

  it('drops an entry whose id is not an identifier', () => {
    const issues: string[] = []
    const parsed = parseProgressions({ progressions: { 'Cannon Recharge': VALID } }, (id) => issues.push(id))
    expect(parsed).toEqual({})
    expect(issues).toEqual(['Cannon Recharge'])
  })

  it('reports when the progressions key itself holds the wrong thing', () => {
    const issues: Array<[string, string]> = []
    expect(parseProgressions({ progressions: [] }, (id, issue) => issues.push([id, issue]))).toEqual({})
    expect(issues[0][0]).toBe('*')
  })

  it('says nothing when the key is simply absent', () => {
    const issues: string[] = []
    parseProgressions({}, (id) => issues.push(id))
    expect(issues).toEqual([])
  })

  it('trims past the ceiling rather than dropping the whole record', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, VALID]))
    const issues: string[] = []
    const parsed = parseProgressions({ progressions: many }, (id) => issues.push(id))
    expect(Object.keys(parsed)).toHaveLength(32)
    expect(issues).toHaveLength(8)
  })

  it('never throws, whatever the shape', () => {
    expect(() => parseProgressions({ progressions: { cannon: null } })).not.toThrow()
    expect(() => parseProgressions({ progressions: { cannon: 'a string' } })).not.toThrow()
  })
})

describe('flattenProgressions', () => {
  const metadata = {
    progressions: {
      cannon: {
        name: 'Cannon recharge',
        startTime: '2026-09-08T14:00:00Z',
        endTime: '2026-09-08T14:10:00Z',
        timeIncrement: 'minute',
        quantity: { total: 1.0, unit: 'MJ', precision: 1 },
      },
    },
  }

  it('keys the sheet "<id>.<field>" and holds only primitives', () => {
    const sheet = flattenProgressions(metadata, CANNON_START + 3 * UNIT_MS.minute)
    expect(Object.keys(sheet).sort()).toEqual([
      'cannon.complete',
      'cannon.elapsed',
      'cannon.elapsedMs',
      'cannon.endTime',
      'cannon.name',
      'cannon.percent',
      'cannon.quantity',
      'cannon.remaining',
      'cannon.remainingMs',
      'cannon.startTime',
      'cannon.started',
      'cannon.state',
    ])
    for (const value of Object.values(sheet)) {
      expect(['number', 'string', 'boolean']).toContain(typeof value)
    }
  })

  it('gives times as epoch milliseconds, so comparators can order them', () => {
    const sheet = flattenProgressions(metadata, CANNON_START)
    expect(sheet['cannon.startTime']).toBe(CANNON_START)
    expect(sheet['cannon.endTime']).toBe(CANNON_START + 10 * UNIT_MS.minute)
  })

  it('flips started and complete across the two boundaries', () => {
    const before = flattenProgressions(metadata, CANNON_START - 1)
    expect(before['cannon.started']).toBe(false)
    expect(before['cannon.complete']).toBe(false)
    expect(before['cannon.state']).toBe('pending')

    const during = flattenProgressions(metadata, CANNON_START + UNIT_MS.minute)
    expect(during['cannon.started']).toBe(true)
    expect(during['cannon.complete']).toBe(false)
    expect(during['cannon.state']).toBe('active')

    const after = flattenProgressions(metadata, CANNON_START + 11 * UNIT_MS.minute)
    expect(after['cannon.complete']).toBe(true)
    expect(after['cannon.state']).toBe('complete')
  })

  it('omits the quantity field when the progression carries no quantity block', () => {
    const sheet = flattenProgressions(
      { progressions: { p: { name: 'P', startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-02T00:00:00Z', timeIncrement: 'hour' } } },
      at('2026-01-01T06:00:00Z')
    )
    expect('p.quantity' in sheet).toBe(false)
  })

  it('is the empty sheet for a character with no progressions', () => {
    expect(flattenProgressions({ faction: 'Ordo Aurum' }, Date.now())).toEqual({})
  })
})

describe('inferIncrement', () => {
  it('picks the unit a span of that length is best spoken in', () => {
    expect(inferIncrement(30 * UNIT_MS.second)).toBe('second')
    expect(inferIncrement(10 * UNIT_MS.minute)).toBe('minute')
    expect(inferIncrement(6 * UNIT_MS.hour)).toBe('hour')
    expect(inferIncrement(5 * UNIT_MS.day)).toBe('day')
    expect(inferIncrement(4 * UNIT_MS.week)).toBe('week')
    expect(inferIncrement(9 * UNIT_MS.month)).toBe('month')
    expect(inferIncrement(5 * UNIT_MS.year)).toBe('year')
  })

  it('places each threshold on the documented side', () => {
    expect(inferIncrement(2 * UNIT_MS.minute - 1)).toBe('second')
    expect(inferIncrement(2 * UNIT_MS.minute)).toBe('minute')
    expect(inferIncrement(2 * UNIT_MS.hour)).toBe('hour')
    expect(inferIncrement(2 * UNIT_MS.day)).toBe('day')
    expect(inferIncrement(2 * UNIT_MS.week)).toBe('week')
    expect(inferIncrement(8 * UNIT_MS.week)).toBe('month')
    expect(inferIncrement(2 * UNIT_MS.year)).toBe('year')
  })

  it('takes the magnitude of a backwards span', () => {
    expect(inferIncrement(-10 * UNIT_MS.minute)).toBe('minute')
  })
})
