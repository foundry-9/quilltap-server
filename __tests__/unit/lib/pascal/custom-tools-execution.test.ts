/**
 * Custom tools — the execution core: parameter resolution, the transform
 * pipeline, outcome evaluation, and templating.
 *
 * These are the paths where a silent defect would be worst: a roll is a
 * persisted, tamper-evident fact, so a wrong number here is a wrong number in
 * the transcript forever.
 */

import {
  executeCustomTool,
  resolveParams,
  matchesWhen,
  renderTemplate,
  formatValue,
  CustomToolRunError,
} from '@/lib/pascal/custom-tools'
import { QtapCustomToolSchema, type QtapCustomTool, type When } from '@/lib/pascal/custom-tool.types'

/** Parse through the real schema so tests can never drift from what loads. */
function define(doc: unknown): QtapCustomTool {
  const result = QtapCustomToolSchema.safeParse(doc)
  if (!result.success) {
    throw new Error(`fixture is not a valid definition: ${result.error.issues.map((i) => i.message).join('; ')}`)
  }
  return result.data
}

const CATCH_ALL = { when: true as const, message: 'fallback', state: 'info' as const }

describe('resolveParams', () => {
  const tool = define({
    name: 'unlock',
    description: 'Attempt to pick the lock.',
    parameters: {
      bonus: { type: 'number', default: 0, min: 0, max: 10 },
      tries: { type: 'integer', default: 1 },
      label: { type: 'string', default: 'lock' },
      loud: { type: 'boolean', default: false },
    },
    outcomes: [CATCH_ALL],
  })

  it('fills every declared parameter from its default', () => {
    expect(resolveParams(tool, {})).toEqual({ bonus: 0, tries: 1, label: 'lock', loud: false })
  })

  it('defaults a parameter that was omitted', () => {
    expect(resolveParams(tool, { bonus: 3 }).tries).toBe(1)
  })

  it('clamps a numeric value up to min', () => {
    expect(resolveParams(tool, { bonus: -5 }).bonus).toBe(0)
  })

  it('clamps a numeric value down to max', () => {
    expect(resolveParams(tool, { bonus: 999 }).bonus).toBe(10)
  })

  it('rounds an integer parameter', () => {
    expect(resolveParams(tool, { tries: 2.6 }).tries).toBe(3)
  })

  it('accepts a numeric string, as models routinely send', () => {
    expect(resolveParams(tool, { bonus: '4' }).bonus).toBe(4)
  })

  it('rejects an unknown parameter rather than ignoring it', () => {
    // Silently dropping it would look like the tool ran as asked.
    expect(() => resolveParams(tool, { bonuss: 5 })).toThrow(CustomToolRunError)
    expect(() => resolveParams(tool, { bonuss: 5 })).toThrow(/not a parameter/)
  })

  it('rejects a non-numeric value for a numeric parameter', () => {
    expect(() => resolveParams(tool, { bonus: 'lots' })).toThrow(/must be a number/)
  })

  it('coerces boolean strings', () => {
    expect(resolveParams(tool, { loud: 'true' }).loud).toBe(true)
    expect(resolveParams(tool, { loud: 'false' }).loud).toBe(false)
  })

  it('treats null as absent and uses the default', () => {
    expect(resolveParams(tool, { bonus: null }).bonus).toBe(0)
  })
})

describe('matchesWhen', () => {
  /** Pose a test about the value alone — the subject bare comparators address. */
  const against = (when: When, value: number) => matchesWhen(when, { value, roll: value, params: {} })

  it('always matches the literal true', () => {
    expect(matchesWhen(true, { value: -999, roll: -999, params: {} })).toBe(true)
  })

  it.each([
    [{ gt: 0.6 }, 0.61, true],
    [{ gt: 0.6 }, 0.6, false],
    [{ gte: 0.6 }, 0.6, true],
    [{ lt: 0.3 }, 0.29, true],
    [{ lt: 0.3 }, 0.3, false],
    [{ lte: 0.3 }, 0.3, true],
    [{ eq: 5 }, 5, true],
    [{ eq: 5 }, 6, false],
    [{ neq: 5 }, 6, true],
    [{ neq: 5 }, 5, false],
  ])('%j against %d is %s', (when, value, expected) => {
    expect(against(when, value)).toBe(expected)
  })

  it('ANDs multiple comparators together', () => {
    const band = { gte: 0.3, lte: 0.6 }
    expect(against(band, 0.45)).toBe(true)
    expect(against(band, 0.3)).toBe(true)
    expect(against(band, 0.6)).toBe(true)
    expect(against(band, 0.29)).toBe(false)
    expect(against(band, 0.61)).toBe(false)
  })

  it('tests the raw roll separately from the transformed value', () => {
    // The whole point of the `roll` subject: after a transform, the two
    // subjects disagree, and only one of them is what was actually drawn.
    const when = { gt: 50, roll: { lt: 0.6 } }
    expect(matchesWhen(when, { value: 55, roll: 0.55, params: {} })).toBe(true)
    expect(matchesWhen(when, { value: 55, roll: 0.7, params: {} })).toBe(false)
  })

  it('ANDs a params test with a value test', () => {
    const when = { gt: 1, params: { scale: { gt: 12 } } }
    expect(matchesWhen(when, { value: 2, roll: 2, params: { scale: 14 } })).toBe(true)
    expect(matchesWhen(when, { value: 2, roll: 2, params: { scale: 12 } })).toBe(false)
    expect(matchesWhen(when, { value: 1, roll: 1, params: { scale: 14 } })).toBe(false)
  })

  it('compares a string parameter with eq/neq', () => {
    const subjects = { value: 0, roll: 0, params: { material: 'brass' } }
    expect(matchesWhen({ params: { material: { eq: 'brass' } } }, subjects)).toBe(true)
    expect(matchesWhen({ params: { material: { eq: 'iron' } } }, subjects)).toBe(false)
    expect(matchesWhen({ params: { material: { neq: 'iron' } } }, subjects)).toBe(true)
  })

  it('compares a boolean parameter with eq', () => {
    const subjects = { value: 0, roll: 0, params: { loudly: true } }
    expect(matchesWhen({ params: { loudly: { eq: true } } }, subjects)).toBe(true)
    expect(matchesWhen({ params: { loudly: { eq: false } } }, subjects)).toBe(false)
  })

  it('resolves a $param operand — the opposed check', () => {
    const when = { gte: { $param: 'difficulty' } }
    expect(matchesWhen(when, { value: 15, roll: 15, params: { difficulty: 12 } })).toBe(true)
    expect(matchesWhen(when, { value: 15, roll: 15, params: { difficulty: 18 } })).toBe(false)
  })

  it('throws rather than declining to match when an ordering test meets a non-number', () => {
    // Load-time validation rejects this shape, so reaching it is a regression.
    // Returning false would look like the table simply skipping a row.
    expect(() =>
      matchesWhen({ params: { material: { gt: 1 } } } as When, { value: 0, roll: 0, params: { material: 'brass' } })
    ).toThrow(CustomToolRunError)
  })
})

describe('matchesWhen — the metadata subject', () => {
  const SHEET = {
    hasAnsibleAccess: true,
    clearanceLevel: 3,
    faction: 'Ordo Aurum',
    knownLanguages: ['Trade Cant'],
    dossier: { rank: 'adept' },
    lastSeen: null,
  }

  /** Pose a test about the sheet alone. */
  const against = (when: When, metadata: Record<string, unknown> = SHEET) =>
    matchesWhen(when, { value: 0, roll: 0, params: {}, metadata })

  it.each([
    ['a boolean that holds', { hasAnsibleAccess: { eq: true } }, true],
    ['a boolean that does not', { hasAnsibleAccess: { eq: false } }, false],
    ['neq against a boolean', { hasAnsibleAccess: { neq: false } }, true],
    ['a number ordered', { clearanceLevel: { gte: 3 } }, true],
    ['a number ordered short', { clearanceLevel: { gt: 3 } }, false],
    ['a number banded', { clearanceLevel: { gte: 2, lte: 4 } }, true],
    ['a string matched', { faction: { eq: 'Ordo Aurum' } }, true],
    ['a string mismatched', { faction: { eq: 'Ordo Ferrum' } }, false],
  ])('%s', (_label, metadata, expected) => {
    expect(against({ metadata } as When)).toBe(expected)
  })

  it('ANDs several metadata keys together', () => {
    expect(against({ metadata: { hasAnsibleAccess: { eq: true }, clearanceLevel: { gte: 3 } } } as When)).toBe(true)
    expect(against({ metadata: { hasAnsibleAccess: { eq: true }, clearanceLevel: { gte: 4 } } } as When)).toBe(false)
  })

  it('ANDs a metadata test with bare, roll, and params subjects', () => {
    const when = {
      gt: 1,
      roll: { lt: 0.6 },
      params: { scale: { gt: 12 } },
      metadata: { hasAnsibleAccess: { eq: true } },
    } as When
    const subjects = { value: 2, roll: 0.55, params: { scale: 14 }, metadata: SHEET }
    expect(matchesWhen(when, subjects)).toBe(true)
    // Every subject is load-bearing: falsify each in turn.
    expect(matchesWhen(when, { ...subjects, value: 1 })).toBe(false)
    expect(matchesWhen(when, { ...subjects, roll: 0.7 })).toBe(false)
    expect(matchesWhen(when, { ...subjects, params: { scale: 12 } })).toBe(false)
    expect(matchesWhen(when, { ...subjects, metadata: { hasAnsibleAccess: false } })).toBe(false)
  })

  it('resolves a $param operand against a metadata key — the opposed check', () => {
    const when = { metadata: { clearanceLevel: { gte: { $param: 'required' } } } } as When
    expect(matchesWhen(when, { value: 0, roll: 0, params: { required: 2 }, metadata: SHEET })).toBe(true)
    expect(matchesWhen(when, { value: 0, roll: 0, params: { required: 4 }, metadata: SHEET })).toBe(false)
  })

  /**
   * The fail-soft rule, which is the whole reason `metadata` is not `params`.
   * Every one of these is a fact about a character rather than an authoring
   * mistake — a table branching on a key must still deal to whoever lacks it —
   * so each declines to match and lets the catch-all answer, and none throw.
   */
  describe('declines rather than throwing when the sheet cannot answer', () => {
    it.each([
      ['a key this character has never heard of', { ansibleAccess: { eq: true } }],
      ['an absent key tested with neq — absence is not inequality', { ansibleAccess: { neq: true } }],
      ['a key holding an array', { knownLanguages: { eq: 'Trade Cant' } }],
      ['a key holding an object', { dossier: { eq: 'adept' } }],
      ['a key holding null', { lastSeen: { neq: 'never' } }],
      ['a string ordered against a number', { faction: { gt: 1 } }],
      ['a number compared against a string', { clearanceLevel: { eq: 'three' } }],
      ['an ordering test whose operand is a string', { clearanceLevel: { gte: 'three' } }],
    ])('%s', (_label, metadata) => {
      expect(() => against({ metadata } as When)).not.toThrow()
      expect(against({ metadata } as When)).toBe(false)
    })

    it('treats a missing metadata sheet as a sheet with nothing on it', () => {
      // Nobody in particular rolled: the subjects carry no metadata at all.
      const when = { metadata: { hasAnsibleAccess: { eq: true } } } as When
      expect(matchesWhen(when, { value: 0, roll: 0, params: {} })).toBe(false)
      expect(against(when, {})).toBe(false)
    })
  })
})

describe('formatValue', () => {
  it('renders integers without decimals', () => {
    expect(formatValue(14)).toBe('14')
    expect(formatValue(-3)).toBe('-3')
  })

  it('renders floats to 4 significant digits', () => {
    expect(formatValue(0.7134567)).toBe('0.7135')
    expect(formatValue(1234.5678)).toBe('1235')
  })
})

describe('renderTemplate', () => {
  const vars = { value: 14, roll: 0.7134567, dice: '3d6+2: [4, 2, 6] + 2 = 14', params: { bonus: 2, who: 'Bertie' } }

  it('substitutes {{value}}, {{roll}}, and {{dice}}', () => {
    expect(renderTemplate('{{value}} / {{roll}} / {{dice}}', vars)).toBe(
      '14 / 0.7135 / 3d6+2: [4, 2, 6] + 2 = 14'
    )
  })

  it('substitutes {{params.name}} for numbers and strings', () => {
    expect(renderTemplate('{{params.bonus}} and {{params.who}}', vars)).toBe('2 and Bertie')
  })

  it('leaves an unknown placeholder verbatim', () => {
    expect(renderTemplate('{{nonsense}} stays', vars)).toBe('{{nonsense}} stays')
  })

  it('leaves an unknown params reference verbatim', () => {
    expect(renderTemplate('{{params.nope}}', vars)).toBe('{{params.nope}}')
  })

  it('does not interpret user text as a template', () => {
    // Substituted values are inserted, never re-scanned.
    const sneaky = { ...vars, params: { who: '{{value}}' } }
    expect(renderTemplate('{{params.who}}', sneaky)).toBe('{{value}}')
  })

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('{{ value }}', vars)).toBe('14')
  })

  describe('the {{metadata.key}} family', () => {
    const sheet = {
      faction: 'Ordo Aurum',
      clearanceLevel: 3,
      trust: 0.7134567,
      hasAnsibleAccess: true,
      knownLanguages: ['Trade Cant'],
      dossier: { rank: 'adept' },
      lastSeen: null,
    }
    const withSheet = { ...vars, metadata: sheet }

    it('substitutes primitives the way {{params.name}} does', () => {
      expect(renderTemplate('{{metadata.faction}} / {{metadata.hasAnsibleAccess}}', withSheet)).toBe(
        'Ordo Aurum / true'
      )
    })

    it('renders an integer undecorated and a float to 4 significant digits', () => {
      expect(renderTemplate('{{metadata.clearanceLevel}} at {{metadata.trust}}', withSheet)).toBe('3 at 0.7135')
    })

    it.each([
      ['an absent key', '{{metadata.nope}}'],
      ['a key holding an array', '{{metadata.knownLanguages}}'],
      ['a key holding an object', '{{metadata.dossier}}'],
      ['a key holding null', '{{metadata.lastSeen}}'],
    ])('leaves %s verbatim rather than eating the hole in the sentence', (_label, template) => {
      expect(renderTemplate(template, withSheet)).toBe(template)
    })

    it('leaves every metadata placeholder verbatim when there is no sheet', () => {
      expect(renderTemplate('{{metadata.faction}}', vars)).toBe('{{metadata.faction}}')
    })

    it('does not re-scan a substituted metadata value as a template', () => {
      const sneaky = { ...vars, metadata: { motto: '{{value}}' } }
      expect(renderTemplate('{{metadata.motto}}', sneaky)).toBe('{{value}}')
    })
  })
})

describe('executeCustomTool — transform pipeline', () => {
  it('applies multiply, then offset, then round, in that order', () => {
    // A degenerate range (min === max) pins raw to 0.5 so the arithmetic is
    // deterministic: 0.5 * 10 = 5, + 2 = 7. Rounding first would give 1*10+2=12.
    const tool = define({
      name: 'pipeline',
      description: 'Pin the raw value and watch the transform.',
      roll: { min: 0.5, max: 0.5, multiplier: 10, offset: 2, round: true },
      outcomes: [CATCH_ALL],
    })
    const result = executeCustomTool(tool, {})
    expect(result.raw).toBe(0.5)
    expect(result.value).toBe(7)
  })

  it('rounds last, not before the offset', () => {
    const tool = define({
      name: 'rounding',
      description: 'Rounding happens after the offset.',
      roll: { min: 0.4, max: 0.4, multiplier: 1, offset: 0.3, round: true },
      outcomes: [CATCH_ALL],
    })
    // 0.4 + 0.3 = 0.7 → 1. Rounding first would be 0 + 0.3 = 0.3 → 0.
    expect(executeCustomTool(tool, {}).value).toBe(1)
  })

  it('substitutes a $param into the offset', () => {
    const tool = define({
      name: 'unlock',
      description: 'Attempt to pick the lock.',
      parameters: { bonus: { type: 'number', default: 0, min: 0, max: 10 } },
      roll: { min: 0, max: 0, offset: { $param: 'bonus' } },
      outcomes: [CATCH_ALL],
    })
    expect(executeCustomTool(tool, { bonus: 4 }).value).toBe(4)
  })

  it('uses the CLAMPED parameter value in the roll, not the raw one', () => {
    const tool = define({
      name: 'unlock',
      description: 'Attempt to pick the lock.',
      parameters: { bonus: { type: 'number', default: 0, min: 0, max: 10 } },
      roll: { min: 0, max: 0, offset: { $param: 'bonus' } },
      outcomes: [CATCH_ALL],
    })
    expect(executeCustomTool(tool, { bonus: 999 }).value).toBe(10)
  })

  it('defaults to a 0–1 uniform roll when `roll` is omitted', () => {
    const tool = define({ name: 'plain', description: 'No roll block.', outcomes: [CATCH_ALL] })
    for (let i = 0; i < 30; i++) {
      const { value } = executeCustomTool(tool, {})
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('draws within [min, max) across many runs', () => {
    const tool = define({
      name: 'ranged',
      description: 'A bounded draw.',
      roll: { min: 10, max: 20 },
      outcomes: [CATCH_ALL],
    })
    for (let i = 0; i < 100; i++) {
      const { value } = executeCustomTool(tool, {})
      expect(value).toBeGreaterThanOrEqual(10)
      expect(value).toBeLessThan(20)
    }
  })

  it('fails rather than fabricating when $param substitution inverts the bounds', () => {
    const tool = define({
      name: 'inverted',
      description: 'Bounds that can cross.',
      parameters: { hi: { type: 'number', default: 10 } },
      roll: { min: 5, max: { $param: 'hi' } },
      outcomes: [CATCH_ALL],
    })
    expect(() => executeCustomTool(tool, { hi: 1 })).toThrow(CustomToolRunError)
    expect(() => executeCustomTool(tool, { hi: 1 })).toThrow(/low bound .* above its high bound/)
  })
})

describe('executeCustomTool — outcome selection', () => {
  const tool = define({
    name: 'unlock',
    description: 'Attempt to pick the lock.',
    roll: { min: 0.7, max: 0.7 },
    outcomes: [
      { when: { gt: 0.6 }, message: 'The lock clicks open.', state: 'success' },
      { when: { lt: 0.3 }, message: 'Still locked.', state: 'failure' },
      { when: true, message: 'The lock is giving way…', state: 'partial' },
    ],
  })

  it('takes the first matching outcome', () => {
    const result = executeCustomTool(tool, {})
    expect(result.outcomeIndex).toBe(0)
    expect(result.state).toBe('success')
    expect(result.message).toBe('The lock clicks open.')
  })

  it('falls through to the catch-all when nothing else matches', () => {
    const midband = define({
      name: 'unlock',
      description: 'Attempt to pick the lock.',
      roll: { min: 0.45, max: 0.45 },
      outcomes: [
        { when: { gt: 0.6 }, message: 'open', state: 'success' },
        { when: { lt: 0.3 }, message: 'locked', state: 'failure' },
        { when: true, message: 'giving way', state: 'partial' },
      ],
    })
    const result = executeCustomTool(midband, {})
    expect(result.outcomeIndex).toBe(2)
    expect(result.state).toBe('partial')
  })

  it('prefers the earlier of two matching outcomes', () => {
    const overlapping = define({
      name: 'overlap',
      description: 'Two outcomes both match.',
      roll: { min: 5, max: 5 },
      outcomes: [
        { when: { gte: 1 }, message: 'first', state: 'success' },
        { when: { gte: 2 }, message: 'second', state: 'info' },
        { when: true, message: 'third', state: 'info' },
      ],
    })
    expect(executeCustomTool(overlapping, {}).message).toBe('first')
  })

  it('selects on the CLAMPED parameter, as the roll does', () => {
    // The one value the table tests must be the one the roll used — a test
    // against the caller's unclamped 999 would contradict the number rolled.
    const tool = define({
      name: 'scan',
      description: 'Test a parameter alongside the value.',
      parameters: { scale: { type: 'number', default: 1, min: 0, max: 12 } },
      roll: { min: 5, max: 5 },
      outcomes: [
        { when: { params: { scale: { gt: 12 } } }, message: 'off the scale', state: 'success' },
        { when: true, message: 'within tolerance', state: 'info' },
      ],
    })
    expect(executeCustomTool(tool, { scale: 999 }).message).toBe('within tolerance')
  })

  it('selects on the raw draw when the outcome tests `roll`', () => {
    // raw 0.5 → value 50, so the two subjects genuinely disagree here.
    const tool = define({
      name: 'scaled',
      description: 'The raw draw and the value disagree.',
      roll: { min: 0.5, max: 0.5, multiplier: 100 },
      outcomes: [
        { when: { roll: { lt: 0.6 } }, message: 'raw was low', state: 'info' },
        { when: true, message: 'fallback', state: 'info' },
      ],
    })
    const result = executeCustomTool(tool, {})
    expect(result.value).toBe(50)
    expect(result.message).toBe('raw was low')
  })

  it('ANDs the value, the raw roll, and a parameter in one test', () => {
    const tool = define({
      name: 'compound',
      description: 'Every subject at once.',
      parameters: { scale: { type: 'integer', default: 1 }, mode: { type: 'string', default: 'passive' } },
      roll: { min: 0.5, max: 0.5, multiplier: 10 },
      outcomes: [
        {
          when: { gt: 1, roll: { gte: 0.5 }, params: { scale: { gt: 12 }, mode: { eq: 'active' } } },
          message: 'all four held',
          state: 'success',
        },
        { when: true, message: 'something did not hold', state: 'info' },
      ],
    })
    expect(executeCustomTool(tool, { scale: 14, mode: 'active' }).message).toBe('all four held')
    // One conjunct false is enough to fall through.
    expect(executeCustomTool(tool, { scale: 14, mode: 'passive' }).message).toBe('something did not hold')
    expect(executeCustomTool(tool, { scale: 12, mode: 'active' }).message).toBe('something did not hold')
  })
})

describe('executeCustomTool — the invoking character\'s metadata', () => {
  /** A gated table: the same roll, dealt differently by who is holding what. */
  const tool = define({
    name: 'ansible',
    description: 'Reach for the ansible.',
    roll: { min: 0.7, max: 0.7 },
    outcomes: [
      {
        when: { gt: 0.6, metadata: { hasAnsibleAccess: { eq: true } } },
        message: 'The ansible flickers to life for {{metadata.faction}}.',
        state: 'success',
      },
      { when: true, message: 'The panel stays dark.', state: 'failure' },
    ],
  })

  it('matches the gated outcome for a character carrying the key', () => {
    const result = executeCustomTool(tool, {}, {
      metadata: { hasAnsibleAccess: true, faction: 'Ordo Aurum' },
    })
    expect(result.state).toBe('success')
    expect(result.message).toBe('The ansible flickers to life for Ordo Aurum.')
  })

  it('falls to the catch-all for a character who has never heard of an ansible', () => {
    const result = executeCustomTool(tool, {}, { metadata: { faction: 'Ordo Ferrum' } })
    expect(result.state).toBe('failure')
    expect(result.message).toBe('The panel stays dark.')
  })

  it('falls to the catch-all when the key is there but false', () => {
    expect(executeCustomTool(tool, {}, { metadata: { hasAnsibleAccess: false } }).state).toBe('failure')
  })

  it('falls to the catch-all when nobody in particular rolled', () => {
    // A characterless manual run passes no sheet at all.
    expect(executeCustomTool(tool, {}).state).toBe('failure')
    expect(executeCustomTool(tool, {}, { metadata: {} }).state).toBe('failure')
  })

  describe('metadataTested — what the winning row saw', () => {
    it('records the keys the winning row consulted, at their roll-time values', () => {
      const result = executeCustomTool(tool, {}, {
        metadata: { hasAnsibleAccess: true, faction: 'Ordo Aurum', clearanceLevel: 3 },
      })
      // Only what the row tested — not the whole sheet, which is the
      // character's business and may hold things the room should not see.
      expect(result.metadataTested).toEqual({ hasAnsibleAccess: true })
    })

    it('is absent when the winning row consulted no metadata', () => {
      expect(executeCustomTool(tool, {}, { metadata: {} }).metadataTested).toBeUndefined()
    })

    it('is absent on a run that never had a sheet', () => {
      expect(executeCustomTool(tool, {}).metadataTested).toBeUndefined()
    })

    it('records every key of a multi-key winning row', () => {
      const gated = define({
        name: 'vault',
        description: 'Open the vault.',
        roll: { min: 0.7, max: 0.7 },
        outcomes: [
          {
            when: { metadata: { clearanceLevel: { gte: 3 }, faction: { eq: 'Ordo Aurum' } } },
            message: 'Open.',
            state: 'success',
          },
          { when: true, message: 'Shut.', state: 'failure' },
        ],
      })
      const result = executeCustomTool(gated, {}, {
        metadata: { clearanceLevel: 3, faction: 'Ordo Aurum', hasAnsibleAccess: true },
      })
      expect(result.state).toBe('success')
      expect(result.metadataTested).toEqual({ clearanceLevel: 3, faction: 'Ordo Aurum' })
    })
  })
})

describe('executeCustomTool — dice form', () => {
  const tool = define({
    name: 'saving_throw',
    description: 'Roll a d20 saving throw against DC 12.',
    roll: '1d20',
    outcomes: [
      { when: { gte: 12 }, message: 'Saved! ({{dice}})', state: 'success' },
      { when: true, message: 'Failed. ({{dice}})', state: 'failure' },
    ],
  })

  it('reports the dice form and its notation', () => {
    const result = executeCustomTool(tool, {})
    expect(result.rollForm).toBe('dice')
    expect(result.notation).toBe('1d20')
    expect(result.diceRolls).toHaveLength(1)
  })

  it('sets raw and value to the dice total', () => {
    const result = executeCustomTool(tool, {})
    expect(result.raw).toBe(result.value)
    expect(result.value).toBeGreaterThanOrEqual(1)
    expect(result.value).toBeLessThanOrEqual(20)
  })

  it('renders {{dice}} as a breakdown', () => {
    const result = executeCustomTool(tool, {})
    expect(result.message).toMatch(/1d20: \[\d+\] = \d+/)
  })

  it('honours a dice modifier in the total', () => {
    const modified = define({
      name: 'modified',
      description: 'Dice with a modifier.',
      roll: '3d6+2',
      outcomes: [CATCH_ALL],
    })
    const result = executeCustomTool(modified, {})
    const facesTotal = result.diceRolls!.reduce((a, b) => a + b, 0)
    expect(result.value).toBe(facesTotal + 2)
  })

  it('leaves {{dice}} empty for a range roll', () => {
    const ranged = define({
      name: 'ranged',
      description: 'A range roll has no dice.',
      roll: { min: 1, max: 2 },
      outcomes: [{ when: true, message: 'x{{dice}}y', state: 'info' }],
    })
    const result = executeCustomTool(ranged, {})
    expect(result.diceBreakdown).toBe('')
    expect(result.message).toBe('xy')
  })
})

describe('executeCustomTool — visibility', () => {
  const publicTool = define({ name: 'a', description: 'd', outcomes: [CATCH_ALL] })
  const whisperTool = define({ name: 'b', description: 'd', defaultVisibility: 'whisper', outcomes: [CATCH_ALL] })

  it('defaults to public', () => {
    expect(executeCustomTool(publicTool, {}).visibility).toBe('public')
  })

  it("honours the definition's whisper default", () => {
    expect(executeCustomTool(whisperTool, {}).visibility).toBe('whisper')
  })

  it('lets an explicit private:true override a public default', () => {
    expect(executeCustomTool(publicTool, {}, { private: true }).visibility).toBe('whisper')
  })

  it('lets an explicit private:false override a whisper default', () => {
    expect(executeCustomTool(whisperTool, {}, { private: false }).visibility).toBe('public')
  })
})
