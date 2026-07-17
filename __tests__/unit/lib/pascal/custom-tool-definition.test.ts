/**
 * Custom tools — the definition format itself: the display title, and the
 * load-time rules that make an authoring mistake a rejection rather than a
 * dead branch nobody notices.
 *
 * Also guards the hand-synced JSON Schema mirror at
 * `public/schemas/qtap-custom-tool.schema.json` against the Zod schema, which
 * is the runtime source of truth. The mirror is what an author's editor
 * consults, so a mirror that has drifted is worse than none: it green-lights a
 * file the loader will refuse, or red-lines one it would have taken.
 */

import Ajv2020 from 'ajv/dist/2020'
import {
  QtapCustomToolSchema,
  displayTitle,
  formatDefinitionIssues,
  MAX_TITLE_LENGTH,
} from '@/lib/pascal/custom-tool.types'

import mirror from '@/public/schemas/qtap-custom-tool.schema.json'
import rangeSpecimen from '@/docs/developer/CUSTOM_TOOL_SPEC.json'
import diceSpecimen from '@/docs/developer/CUSTOM_TOOL_SPEC_DICE.json'

/** The narrowest definition the schema will accept. */
const BASE = {
  name: 'probe',
  description: 'A probe.',
  outcomes: [{ when: true, message: '-', state: 'info' }],
}

/** A definition whose first outcome carries `when`, with a trailing catch-all. */
function withWhen(when: unknown, extra: Record<string, unknown> = {}) {
  return {
    ...BASE,
    ...extra,
    outcomes: [
      { when, message: '-', state: 'info' },
      { when: true, message: '-', state: 'info' },
    ],
  }
}

const NUM_PARAM = { parameters: { scale: { type: 'number', default: 1 } } }
const STR_PARAM = { parameters: { material: { type: 'string', default: 'brass' } } }

/**
 * The rejection an author would actually read on the load-error badge — the
 * same rendering `loadToolsFromMount` puts there, so these assertions cover
 * the message and not merely the verdict.
 */
function rejection(doc: unknown): string {
  const result = QtapCustomToolSchema.safeParse(doc)
  if (result.success) throw new Error('expected the definition to be rejected, but it parsed')
  return formatDefinitionIssues(result.error)
}

function accepts(doc: unknown): boolean {
  return QtapCustomToolSchema.safeParse(doc).success
}

describe('displayTitle', () => {
  it('prefers the authored title', () => {
    expect(displayTitle({ name: 'scan_hawking_radiation', title: 'Hawking Sweep' })).toBe('Hawking Sweep')
  })

  it('title-cases the name when no title is authored', () => {
    expect(displayTitle({ name: 'scan_hawking_radiation' })).toBe('Scan Hawking Radiation')
  })

  it('treats hyphens as word breaks too', () => {
    expect(displayTitle({ name: 'force-the-lock' })).toBe('Force The Lock')
  })

  it('leaves a single-word name capitalized', () => {
    expect(displayTitle({ name: 'unlock' })).toBe('Unlock')
  })

  it('does not disturb an authored title beyond trimming it', () => {
    // The author's capitalization is theirs — 'vs.' must not become 'Vs.'.
    expect(displayTitle({ name: 'saving_throw', title: '  Save vs. the House  ' })).toBe('Save vs. the House')
  })

  it('falls back to the name when the title is only whitespace', () => {
    expect(displayTitle({ name: 'saving_throw', title: '   ' })).toBe('Saving Throw')
  })
})

describe('title', () => {
  it('is optional', () => {
    expect(accepts(BASE)).toBe(true)
  })

  it('accepts a title within the cap', () => {
    expect(accepts({ ...BASE, title: 'x'.repeat(MAX_TITLE_LENGTH) })).toBe(true)
  })

  it('rejects an empty title rather than silently deriving one', () => {
    expect(accepts({ ...BASE, title: '' })).toBe(false)
  })

  it('rejects a title past the cap', () => {
    expect(accepts({ ...BASE, title: 'x'.repeat(MAX_TITLE_LENGTH + 1) })).toBe(false)
  })
})

describe('when — subjects', () => {
  it('still accepts a bare comparator, which tests the value', () => {
    // Every definition written before `roll`/`params` existed must still load.
    expect(accepts(withWhen({ gte: 0.3, lte: 0.6 }))).toBe(true)
  })

  it('accepts a roll subject', () => {
    expect(accepts(withWhen({ roll: { gte: 15 } }))).toBe(true)
  })

  it('accepts a params subject ANDed with a value test', () => {
    expect(accepts(withWhen({ gt: 1, params: { scale: { gt: 12 } } }, NUM_PARAM))).toBe(true)
  })

  it('accepts eq against a string parameter', () => {
    expect(accepts(withWhen({ params: { material: { eq: 'brass' } } }, STR_PARAM))).toBe(true)
  })

  it('accepts a $param operand', () => {
    expect(accepts(withWhen({ gte: { $param: 'scale' } }, NUM_PARAM))).toBe(true)
  })

  it('rejects a test that tests nothing', () => {
    expect(rejection(withWhen({}))).toMatch(/must test something/)
  })

  it('rejects an empty params object', () => {
    expect(rejection(withWhen({ params: {} }))).toMatch(/must test something/)
  })

  it('rejects an empty comparator on roll', () => {
    expect(rejection(withWhen({ roll: {} }))).toMatch(/at least one comparator/)
  })

  it('accepts a metadata subject ANDed with a value test', () => {
    expect(accepts(withWhen({ gt: 0.6, metadata: { hasAnsibleAccess: { eq: true } } }))).toBe(true)
  })

  it('accepts a metadata subject as the only test', () => {
    expect(accepts(withWhen({ metadata: { clearanceLevel: { gte: 3 } } }))).toBe(true)
  })

  it('rejects an empty metadata object', () => {
    expect(rejection(withWhen({ metadata: {} }))).toMatch(/must test something/)
  })

  it('rejects an empty comparator on a metadata key', () => {
    expect(rejection(withWhen({ metadata: { faction: {} } }))).toMatch(/at least one comparator/)
  })
})

describe('when — the metadata subject', () => {
  it('takes keys in the USER\'s vocabulary, not our identifier grammar', () => {
    // metadata.json is hand-authored: camelCase, capitals, and spaces are all
    // perfectly ordinary keys there, and none would pass the `params` pattern.
    expect(accepts(withWhen({ metadata: { hasAnsibleAccess: { eq: true } } }))).toBe(true)
    expect(accepts(withWhen({ metadata: { 'Clearance Level': { gte: 3 } } }))).toBe(true)
    expect(accepts(withWhen({ metadata: { HOUSE: { eq: 'Aurum' } } }))).toBe(true)
  })

  it('rejects an empty-string key', () => {
    expect(accepts(withWhen({ metadata: { '': { eq: 1 } } }))).toBe(false)
  })

  it('rejects a misspelled comparator inside a metadata test', () => {
    // Strict, like every other nested object: tolerating `gt3` would silently
    // drop the test and leave the row looking like a dead branch.
    expect(accepts(withWhen({ metadata: { faction: { eq: 'Aurum', nonsense: 1 } } }))).toBe(false)
  })

  it('accepts a $param operand against a metadata key — the opposed check', () => {
    expect(
      accepts(withWhen({ metadata: { clearanceLevel: { gte: { $param: 'scale' } } } }, NUM_PARAM))
    ).toBe(true)
  })

  it('still rejects a $param operand naming an undeclared parameter', () => {
    // The one thing a metadata test CAN be checked on at load: its operands.
    expect(rejection(withWhen({ metadata: { clearanceLevel: { gte: { $param: 'nope' } } } }, NUM_PARAM))).toMatch(
      /references undeclared parameter "nope"/
    )
  })

  /**
   * The deliberate gap. A metadata key names something on a character the file
   * has never met, so neither its existence nor its type is knowable here —
   * `matchesWhen` closes this fail-soft at run time instead.
   */
  it('accepts a test of a key no character may ever have', () => {
    expect(accepts(withWhen({ metadata: { utterlyMadeUp: { eq: true } } }))).toBe(true)
  })

  it('accepts an ordering test that only a numeric key could satisfy', () => {
    // Unlike the params equivalent, which is a load-time rejection: we cannot
    // know that `faction` holds a string until a character turns up holding one.
    expect(accepts(withWhen({ metadata: { faction: { gt: 1 } } }))).toBe(true)
  })
})

describe('when — reference and type rules', () => {
  it('rejects a test of an undeclared parameter', () => {
    expect(rejection(withWhen({ params: { scael: { gt: 12 } } }, NUM_PARAM))).toMatch(
      /tests undeclared parameter "scael"/
    )
  })

  it('rejects a $param operand naming an undeclared parameter', () => {
    expect(rejection(withWhen({ gte: { $param: 'nope' } }, NUM_PARAM))).toMatch(
      /references undeclared parameter "nope"/
    )
  })

  it('rejects ordering a string parameter', () => {
    expect(rejection(withWhen({ params: { material: { gt: 1 } } }, STR_PARAM))).toMatch(/only numbers can be ordered/)
  })

  it('rejects comparing the value with a string', () => {
    // The value is always a number, so this could never hold at run time. The
    // type layer catches it before the cross-field rules ever run.
    expect(rejection(withWhen({ eq: 'brass' }))).toMatch(/expected number/)
  })

  it('rejects a parameter compared against the wrong type', () => {
    expect(rejection(withWhen({ params: { material: { eq: 5 } } }, STR_PARAM))).toMatch(/can never hold/)
  })

  it('points the issue at the offending outcome', () => {
    const result = QtapCustomToolSchema.safeParse(withWhen({ params: { nope: { gt: 1 } } }, NUM_PARAM))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0].path).toEqual(['outcomes', 0, 'when', 'params', 'nope'])
  })

  it('still rejects a roll field referencing a non-numeric parameter', () => {
    expect(
      rejection({ ...BASE, ...STR_PARAM, roll: { offset: { $param: 'material' } } })
    ).toMatch(/rather than numeric/)
  })
})

describe('reference specimens', () => {
  it.each([
    ['CUSTOM_TOOL_SPEC.json', rangeSpecimen],
    ['CUSTOM_TOOL_SPEC_DICE.json', diceSpecimen],
  ])('%s is a valid definition', (_name, specimen) => {
    // Asserting on the reason, not the boolean: a specimen that stops parsing
    // should say why in the failure output rather than just 'false'.
    const result = QtapCustomToolSchema.safeParse(specimen)
    expect(result.success ? '' : formatDefinitionIssues(result.error)).toBe('')
  })
})

describe('the JSON Schema mirror agrees with Zod', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true })
  const validate = ajv.compile(mirror)

  /**
   * Each case is checked against BOTH schemas and the verdicts compared. What
   * matters is agreement, not the verdict itself — so the table needs no
   * expected column, and a new rule added to one schema and not the other
   * shows up here rather than in an author's editor.
   */
  const corpus: Array<[string, unknown]> = [
    ['the range specimen', rangeSpecimen],
    ['the dice specimen', diceSpecimen],
    ['a bare minimum definition', BASE],
    ['an authored title', { ...BASE, title: 'Probe the Thing' }],
    ['an empty title', { ...BASE, title: '' }],
    ['an over-long title', { ...BASE, title: 'x'.repeat(MAX_TITLE_LENGTH + 1) }],
    ['a legacy value comparator', withWhen({ gte: 0.3, lte: 0.6 })],
    ['a roll subject', withWhen({ roll: { gte: 15 } })],
    ['a params subject', withWhen({ gt: 1, params: { scale: { gt: 12 } } }, NUM_PARAM)],
    ['eq against a string parameter', withWhen({ params: { material: { eq: 'brass' } } }, STR_PARAM)],
    ['a $param operand', withWhen({ gte: { $param: 'scale' } }, NUM_PARAM)],
    ['a metadata subject', withWhen({ gt: 0.6, metadata: { hasAnsibleAccess: { eq: true } } })],
    ['a metadata key outside the identifier grammar', withWhen({ metadata: { 'Clearance Level': { gte: 3 } } })],
    ['an empty-string metadata key', withWhen({ metadata: { '': { eq: 1 } } })],
    ['an empty metadata object', withWhen({ metadata: {} })],
    ['an empty comparator on a metadata key', withWhen({ metadata: { faction: {} } })],
    ['an unknown key inside a metadata comparator', withWhen({ metadata: { faction: { eq: 'a', gt3: 1 } } })],
    ['a $param operand on a metadata key', withWhen({ metadata: { level: { gte: { $param: 'scale' } } } }, NUM_PARAM)],
    ['a test that tests nothing', withWhen({})],
    ['an empty params object', withWhen({ params: {} })],
    ['an empty roll comparator', withWhen({ roll: {} })],
    ['an unknown key inside when', withWhen({ nonsense: 1 })],
    ['an unknown key beside a real comparator', withWhen({ gt: 1, gt3: 2 })],
    ['an unknown key inside an outcome', { ...BASE, outcomes: [{ when: true, message: '-', state: 'info', x: 1 }] }],
    ['an unknown key inside a roll range', { ...BASE, roll: { min: 0, max: 1, bogus: 3 }, outcomes: BASE.outcomes }],
    ['a malformed $param ref', withWhen({ gte: { $param: 'Not An Identifier' } }, NUM_PARAM)],
    ['a string compared with the value', withWhen({ eq: 'brass' })],
    ['an unknown outcome state', { ...BASE, outcomes: [{ when: true, message: '-', state: 'triumph' }] }],
  ]

  it.each(corpus)('on %s', (_label, doc) => {
    expect(validate(doc)).toBe(accepts(doc))
  })

  /**
   * The known, accepted divergence. JSON Schema can say what every outcome
   * looks like but not what the LAST one must be, so the cross-item rules —
   * the mandatory trailing catch-all, and every `$param` reference resolving —
   * are the loader's alone. The mirror is a superset: what it rejects, Zod
   * rejects; what it accepts, Zod may still refuse. Authors are told so in the
   * `outcomes` description, and the badge explains it when it happens.
   */
  it('is deliberately weaker than Zod on cross-item rules', () => {
    const noCatchAll = { ...BASE, outcomes: [{ when: { gt: 1 }, message: '-', state: 'info' }] }
    expect(validate(noCatchAll)).toBe(true)
    expect(accepts(noCatchAll)).toBe(false)
  })
})
