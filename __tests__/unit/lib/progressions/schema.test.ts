/**
 * Character progressions — the schema, and its published JSON Schema mirror.
 *
 * Two jobs. The accept/reject matrix pins what a progression IS: which fields
 * are required, which defaults fill in, and which malformed entries the runtime
 * refuses. The agreement suite guards `public/schemas/qtap-progression.schema.json`
 * against the Zod schema, which is the runtime source of truth — a mirror that
 * has drifted is worse than none, because it green-lights a `metadata.json` the
 * loader will drop, or red-lines one it would have kept.
 */

import Ajv2020 from 'ajv/dist/2020'

import {
  ProgressionSchema,
  ProgressionsSchema,
  PROGRESSION_ID_PATTERN,
  REPORT_FREQUENCY_PATTERN,
  MAX_PROGRESSIONS_PER_CHARACTER,
  isWritableProgressionField,
  parseIsoInstant,
} from '@/lib/progressions/schema'

import mirror from '@/public/schemas/qtap-progression.schema.json'

/** The narrowest progression the schema will accept. */
const BASE = {
  name: 'Cannon recharge',
  startTime: '2026-09-08T14:02:10Z',
  endTime: '2026-09-08T14:12:10Z',
  timeIncrement: 'minute',
}

function accepts(doc: unknown): boolean {
  return ProgressionSchema.safeParse(doc).success
}

function rejection(doc: unknown): string {
  const result = ProgressionSchema.safeParse(doc)
  if (result.success) throw new Error('expected the progression to be rejected, but it parsed')
  return result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
}

describe('parseIsoInstant', () => {
  it('takes an instant with Z', () => {
    expect(parseIsoInstant('2026-08-01T00:00:00Z')).toBe(Date.parse('2026-08-01T00:00:00Z'))
  })

  it('takes an instant with a numeric offset, colon or not', () => {
    expect(parseIsoInstant('2026-08-01T00:00:00-05:00')).toBe(Date.parse('2026-08-01T05:00:00Z'))
    expect(parseIsoInstant('2026-08-01T00:00:00-0500')).toBe(Date.parse('2026-08-01T05:00:00Z'))
  })

  it('takes fractional seconds', () => {
    expect(Number.isFinite(parseIsoInstant('2026-08-01T00:00:00.123Z'))).toBe(true)
  })

  it('takes a minute-precision instant', () => {
    expect(parseIsoInstant('2026-08-01T00:00Z')).toBe(Date.parse('2026-08-01T00:00:00Z'))
  })

  it('refuses a timestamp with no zone — a local reading is not an instant', () => {
    expect(Number.isNaN(parseIsoInstant('2026-08-01T00:00:00'))).toBe(true)
  })

  it('refuses a bare date, a year, and prose', () => {
    for (const value of ['2026-08-01', '2026', 'next Tuesday', '']) {
      expect(Number.isNaN(parseIsoInstant(value))).toBe(true)
    }
  })

  it('refuses a non-string', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(Number.isNaN(parseIsoInstant(value))).toBe(true)
    }
  })

  it('refuses a shape-legal date that names no real day', () => {
    expect(Number.isNaN(parseIsoInstant('2026-13-45T00:00:00Z'))).toBe(true)
  })
})

describe('ProgressionSchema', () => {
  it('accepts the narrowest entry', () => {
    expect(accepts(BASE)).toBe(true)
  })

  it('fills the documented defaults', () => {
    const parsed = ProgressionSchema.parse(BASE)
    expect(parsed.percentageReport).toBe(true)
    expect(parsed.reportFrequency).toBe('turn')
    expect(parsed.onComplete).toBe('keep')
  })

  it('accepts the fully furnished entry from the spec', () => {
    expect(
      accepts({
        ...BASE,
        description: 'You are carrying a child.',
        percentageReport: false,
        reportFrequency: '1h',
        quantity: { total: 1.0, unit: 'MJ', precision: 1 },
        reportTemplate: '{{description}} You are {{elapsedWhole}} along; due in {{remaining}}.',
        onComplete: 'once',
        updatedAt: '2026-09-08T14:02:10Z',
      })
    ).toBe(true)
  })

  it('defaults quantity precision to one decimal place', () => {
    const parsed = ProgressionSchema.parse({ ...BASE, quantity: { total: 1, unit: 'MJ' } })
    expect(parsed.quantity?.precision).toBe(1)
  })

  it('requires endTime strictly after startTime', () => {
    expect(rejection({ ...BASE, endTime: BASE.startTime })).toContain('strictly after startTime')
    expect(rejection({ ...BASE, endTime: '2026-09-08T14:00:00Z' })).toContain('strictly after startTime')
  })

  it('refuses an unknown key — the shape is strict so a v2 field can be added additively', () => {
    expect(accepts({ ...BASE, stages: [] })).toBe(false)
  })

  it('refuses each missing required field', () => {
    for (const field of ['name', 'startTime', 'endTime', 'timeIncrement']) {
      const doc: Record<string, unknown> = { ...BASE }
      delete doc[field]
      expect(accepts(doc)).toBe(false)
    }
  })

  it('refuses an empty name and one over 80 characters', () => {
    expect(accepts({ ...BASE, name: '' })).toBe(false)
    expect(accepts({ ...BASE, name: 'x'.repeat(81) })).toBe(false)
    expect(accepts({ ...BASE, name: 'x'.repeat(80) })).toBe(true)
  })

  it('refuses an increment outside the seven units', () => {
    expect(accepts({ ...BASE, timeIncrement: 'fortnight' })).toBe(false)
  })

  it('refuses a quantity total that is zero, negative or non-finite', () => {
    for (const total of [0, -1, Infinity, NaN]) {
      expect(accepts({ ...BASE, quantity: { total, unit: 'MJ' } })).toBe(false)
    }
  })

  it('refuses a report template over the ceiling and an empty one', () => {
    expect(accepts({ ...BASE, reportTemplate: '' })).toBe(false)
    expect(accepts({ ...BASE, reportTemplate: 'x'.repeat(501) })).toBe(false)
    expect(accepts({ ...BASE, reportTemplate: 'x'.repeat(500) })).toBe(true)
  })

  it('refuses an onComplete outside keep/once', () => {
    expect(accepts({ ...BASE, onComplete: 'delete' })).toBe(false)
  })
})

describe('REPORT_FREQUENCY_PATTERN', () => {
  const takes = (value: string) => REPORT_FREQUENCY_PATTERN.test(value)

  it('takes the two words', () => {
    expect(takes('turn')).toBe(true)
    expect(takes('increment')).toBe(true)
  })

  it('takes <n><unit> for each of the five period units', () => {
    for (const value of ['30s', '5m', '1h', '2d', '3w']) expect(takes(value)).toBe(true)
  })

  it('refuses a zero or leading-zero count, a bare unit, and a bare number', () => {
    for (const value of ['0h', '01h', 'h', '5', '']) expect(takes(value)).toBe(false)
  })

  it('refuses month and year periods — those are increments, not wall-clock buckets', () => {
    expect(takes('1M')).toBe(false)
    expect(takes('1y')).toBe(false)
  })

  it('refuses free text and a cron expression', () => {
    expect(takes('every hour')).toBe(false)
    expect(takes('0 * * * *')).toBe(false)
  })

  it('is the rule the schema actually applies', () => {
    expect(accepts({ ...BASE, reportFrequency: '90m' })).toBe(true)
    expect(accepts({ ...BASE, reportFrequency: 'sometimes' })).toBe(false)
  })
})

describe('PROGRESSION_ID_PATTERN', () => {
  it('takes lowercase identifiers with digits, underscores and hyphens', () => {
    for (const id of ['cannon', 'c', 'main_gun-2', 'a'.repeat(64)]) {
      expect(PROGRESSION_ID_PATTERN.test(id)).toBe(true)
    }
  })

  it('refuses uppercase, a leading digit, a leading underscore, spaces, dots and 65 characters', () => {
    for (const id of ['Cannon', '2cannon', '_cannon', 'main gun', 'a.b', '', 'a'.repeat(65)]) {
      expect(PROGRESSION_ID_PATTERN.test(id)).toBe(false)
    }
  })
})

describe('ProgressionsSchema', () => {
  it('accepts a record keyed by identifier', () => {
    expect(ProgressionsSchema.safeParse({ cannon: BASE, pregnancy: BASE }).success).toBe(true)
  })

  it('accepts the empty record — a character carrying nothing', () => {
    expect(ProgressionsSchema.safeParse({}).success).toBe(true)
  })

  it('refuses a key that is not an identifier', () => {
    expect(ProgressionsSchema.safeParse({ 'Cannon Recharge': BASE }).success).toBe(false)
  })

  it(`refuses more than ${MAX_PROGRESSIONS_PER_CHARACTER} entries`, () => {
    const build = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}`, BASE]))
    expect(ProgressionsSchema.safeParse(build(MAX_PROGRESSIONS_PER_CHARACTER)).success).toBe(true)
    expect(ProgressionsSchema.safeParse(build(MAX_PROGRESSIONS_PER_CHARACTER + 1)).success).toBe(false)
  })
})

describe('isWritableProgressionField', () => {
  it('admits every field a Pascal effect may write, plus the remove pseudo-field', () => {
    for (const field of [
      'name',
      'description',
      'startTime',
      'endTime',
      'timeIncrement',
      'percentageReport',
      'reportFrequency',
      'onComplete',
      'reportTemplate',
      'quantity.total',
      'quantity.unit',
      'quantity.precision',
      'remove',
    ]) {
      expect(isWritableProgressionField(field)).toBe(true)
    }
  })

  it('refuses updatedAt — the applier stamps that, an author does not', () => {
    expect(isWritableProgressionField('updatedAt')).toBe(false)
  })

  it('refuses derived fields and the whole quantity block', () => {
    for (const field of ['percent', 'complete', 'elapsed', 'quantity', 'id', '']) {
      expect(isWritableProgressionField(field)).toBe(false)
    }
  })
})

/**
 * The mirror suite. One corpus, both validators, assert they agree. The
 * `endTime > startTime` cross-field rule is the one accepted divergence —
 * JSON Schema draft 2020-12 cannot compare two sibling properties — and is
 * asserted explicitly below rather than silently tolerated.
 */
describe('qtap-progression.schema.json mirrors the Zod schema', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true })
  const validate = ajv.compile(mirror)

  /** Every specimen, and whether the RUNTIME takes it. */
  const CORPUS: Array<{ label: string; doc: unknown; zodAccepts: boolean }> = [
    { label: 'the narrowest entry', doc: { cannon: BASE }, zodAccepts: true },
    { label: 'the empty record', doc: {}, zodAccepts: true },
    {
      label: 'a fully furnished entry',
      doc: {
        pregnancy: {
          name: 'Pregnancy',
          description: 'You are carrying a child.',
          startTime: '2026-08-01T00:00:00Z',
          endTime: '2027-05-01T00:00:00Z',
          timeIncrement: 'week',
          percentageReport: false,
          reportFrequency: '1h',
          reportTemplate: '{{description}} You are {{elapsedWhole}} along; due in {{remaining}}.',
          onComplete: 'keep',
          updatedAt: '2026-08-01T00:00:00Z',
        },
      },
      zodAccepts: true,
    },
    {
      label: 'an entry with a quantity block',
      doc: { cannon: { ...BASE, quantity: { total: 1.0, unit: 'MJ', precision: 1 } } },
      zodAccepts: true,
    },
    { label: 'an unknown field', doc: { cannon: { ...BASE, stages: [] } }, zodAccepts: false },
    { label: 'a non-identifier id', doc: { 'Cannon Recharge': BASE }, zodAccepts: false },
    { label: 'a missing timeIncrement', doc: { cannon: { ...BASE, timeIncrement: undefined } }, zodAccepts: false },
    { label: 'an unknown increment', doc: { cannon: { ...BASE, timeIncrement: 'fortnight' } }, zodAccepts: false },
    { label: 'a zoneless startTime', doc: { cannon: { ...BASE, startTime: '2026-09-08T14:02:10' } }, zodAccepts: false },
    { label: 'a cron cadence', doc: { cannon: { ...BASE, reportFrequency: '0 * * * *' } }, zodAccepts: false },
    { label: 'a zero-count cadence', doc: { cannon: { ...BASE, reportFrequency: '0h' } }, zodAccepts: false },
    { label: 'an empty name', doc: { cannon: { ...BASE, name: '' } }, zodAccepts: false },
    { label: 'a non-positive quantity total', doc: { cannon: { ...BASE, quantity: { total: 0, unit: 'MJ' } } }, zodAccepts: false },
    { label: 'an onComplete outside the enum', doc: { cannon: { ...BASE, onComplete: 'delete' } }, zodAccepts: false },
    {
      label: `more than ${MAX_PROGRESSIONS_PER_CHARACTER} entries`,
      doc: Object.fromEntries(Array.from({ length: MAX_PROGRESSIONS_PER_CHARACTER + 1 }, (_, i) => [`p${i}`, BASE])),
      zodAccepts: false,
    },
  ]

  it.each(CORPUS)('agrees on $label', ({ doc, zodAccepts }) => {
    // `undefined` isn't representable in JSON; JSON.parse/stringify is how the
    // file would actually reach a validator, and drops the key as a hand edit
    // omitting it would.
    const asJson = JSON.parse(JSON.stringify(doc))
    expect(ProgressionsSchema.safeParse(asJson).success).toBe(zodAccepts)
    expect(validate(asJson)).toBe(zodAccepts)
  })

  it('diverges on the one cross-field rule JSON Schema cannot express', () => {
    const backwards = { cannon: { ...BASE, endTime: '2026-09-08T14:00:00Z' } }
    expect(ProgressionsSchema.safeParse(backwards).success).toBe(false)
    expect(validate(backwards)).toBe(true)
  })
})
