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
import { QtapCustomToolSchema, type QtapCustomTool } from '@/lib/pascal/custom-tool.types'

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
  it('always matches the literal true', () => {
    expect(matchesWhen(true, -999)).toBe(true)
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
    expect(matchesWhen(when, value)).toBe(expected)
  })

  it('ANDs multiple comparators together', () => {
    const band = { gte: 0.3, lte: 0.6 }
    expect(matchesWhen(band, 0.45)).toBe(true)
    expect(matchesWhen(band, 0.3)).toBe(true)
    expect(matchesWhen(band, 0.6)).toBe(true)
    expect(matchesWhen(band, 0.29)).toBe(false)
    expect(matchesWhen(band, 0.61)).toBe(false)
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
