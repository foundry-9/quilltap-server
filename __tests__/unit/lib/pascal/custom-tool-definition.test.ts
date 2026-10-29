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

import fs from 'fs'
import path from 'path'
import Ajv2020 from 'ajv/dist/2020'
import {
  QtapCustomToolSchema,
  displayTitle,
  formatDefinitionIssues,
  parseEffectTarget,
  MAX_TITLE_LENGTH,
  MAX_CHIP_LABEL_LENGTH,
  MAX_EFFECTS,
  KNOWN_TOP_LEVEL_KEYS,
  MAX_WHEN_GROUPS,
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
const LLM_BLOCK = { llm: { prompt: 'Answer YES or NO: is {{value}} auspicious?', errorMessage: 'The wire went dead.' } }

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

/** A definition carrying one effect (with a trailing catch-all outcome). */
function withEffects(effects: unknown, extra: Record<string, unknown> = {}) {
  return { ...BASE, ...extra, effects }
}

describe('chipLabel', () => {
  it('is optional', () => {
    expect(accepts(BASE)).toBe(true)
  })

  it('accepts a templated label within the cap', () => {
    expect(accepts({ ...BASE, chipLabel: 'Agent lambda — {{params.label}}' })).toBe(true)
  })

  it('rejects an empty chipLabel', () => {
    expect(accepts({ ...BASE, chipLabel: '' })).toBe(false)
  })

  it('rejects a chipLabel past the cap', () => {
    expect(accepts({ ...BASE, chipLabel: 'x'.repeat(MAX_CHIP_LABEL_LENGTH + 1) })).toBe(false)
  })

  it('tolerates an unknown placeholder — the renderTemplate doctrine, no load-time reference rule', () => {
    expect(accepts({ ...BASE, chipLabel: '{{params.never_declared}}' })).toBe(true)
  })
})

describe('parseEffectTarget', () => {
  it('parses a state target into a path', () => {
    const result = parseEffectTarget('state.encounter.count')
    expect(result.ok && result.target).toEqual({
      kind: 'state',
      path: ['encounter', 'count'],
      raw: 'state.encounter.count',
    })
  })

  it('takes a metadata key WHOLE — dots inside the key are part of it', () => {
    const result = parseEffectTarget('metadata.ansible.tool')
    expect(result.ok && result.target).toEqual({ kind: 'metadata', key: 'ansible.tool', raw: 'metadata.ansible.tool' })
  })

  it('rejects a target with neither prefix', () => {
    const result = parseEffectTarget('encounter.count')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('must start with')
  })

  it('rejects an empty state path', () => {
    expect(parseEffectTarget('state.').ok).toBe(false)
  })

  it('rejects an empty metadata key', () => {
    expect(parseEffectTarget('metadata.').ok).toBe(false)
  })

  it('rejects a state path whose first segment starts with an underscore — user-only keys', () => {
    const result = parseEffectTarget('state._secrets.combo')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('user-only')
  })

  it('allows an underscore deeper in the path — the guard is on the first segment', () => {
    expect(parseEffectTarget('state.encounter._notes').ok).toBe(true)
  })
})

describe('effects — load-time validation', () => {
  it('accepts a literal-number effect with no condition', () => {
    expect(accepts(withEffects([{ target: 'state.encounter.count', value: 3 }]))).toBe(true)
  })

  it('accepts a boolean literal and a quoted-string expression', () => {
    expect(
      accepts(
        withEffects([
          { target: 'metadata.lockBroken', value: true },
          { target: 'metadata.lockpick', value: "'broken pick'" },
        ])
      )
    ).toBe(true)
  })

  it('accepts an expression over the run subjects', () => {
    expect(
      accepts(withEffects([{ target: 'state.tally', value: '{{state.tally}} + {{params.scale}}' }], NUM_PARAM))
    ).toBe(true)
  })

  it('accepts an outcome-state condition', () => {
    expect(
      accepts(withEffects([{ when: { outcome: { eq: 'success' } }, target: 'state.wins', value: 1 }]))
    ).toBe(true)
  })

  it('accepts a metadata condition on an effect', () => {
    expect(
      accepts(withEffects([{ when: { metadata: { hasKey: { eq: true } } }, target: 'state.opened', value: true }]))
    ).toBe(true)
  })

  it('rejects the bare-prose value — the quoting trap fails loudly', () => {
    expect(rejection(withEffects([{ target: 'metadata.lockpick', value: 'broken pick' }]))).toMatch(
      /not a valid expression/
    )
  })

  it('rejects a target that is neither state. nor metadata.', () => {
    expect(rejection(withEffects([{ target: 'somewhere.else', value: 1 }]))).toMatch(/must start with/)
  })

  it('rejects an underscore-guarded state target', () => {
    expect(rejection(withEffects([{ target: 'state._secrets.combo', value: 1 }]))).toMatch(/user-only/)
  })

  it('rejects an expression referencing an undeclared parameter', () => {
    expect(rejection(withEffects([{ target: 'state.x', value: '{{params.ghost}} + 1' }]))).toMatch(
      /undeclared parameter "ghost"/
    )
  })

  it('rejects an {{llm}} reference on a tool with no llm block', () => {
    expect(rejection(withEffects([{ target: 'metadata.verdict', value: '{{llm}}' }]))).toMatch(
      /declares no `llm` block/
    )
  })

  it('accepts an {{llm}} reference when the tool consults', () => {
    expect(accepts(withEffects([{ target: 'metadata.verdict', value: '{{llm}}' }], LLM_BLOCK))).toBe(true)
  })

  it('rejects an llm when-subject on a tool with no llm block', () => {
    expect(rejection(withEffects([{ when: { llm: { ok: true } }, target: 'state.x', value: 1 }]))).toMatch(
      /declares no `llm` block/
    )
  })

  it("rejects a when testing an undeclared parameter — the outcome rows' walk, shared", () => {
    expect(rejection(withEffects([{ when: { params: { ghost: { gt: 1 } } }, target: 'state.x', value: 1 }]))).toMatch(
      /tests undeclared parameter "ghost"/
    )
  })

  it('renders effect issues at effects.N paths', () => {
    const result = QtapCustomToolSchema.safeParse(withEffects([{ target: 'nowhere', value: 1 }]))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(formatDefinitionIssues(result.error)).toMatch(/effects\.0\.target/)
  })

  it('rejects more effects than the cap', () => {
    const many = Array.from({ length: MAX_EFFECTS + 1 }, (_, i) => ({ target: `state.k${i}`, value: 1 }))
    expect(accepts(withEffects(many))).toBe(false)
  })

  it('rejects an empty outcome condition', () => {
    expect(accepts(withEffects([{ when: { outcome: {} }, target: 'state.x', value: 1 }]))).toBe(false)
  })

  it('rejects a when that tests nothing', () => {
    expect(rejection(withEffects([{ when: {}, target: 'state.x', value: 1 }]))).toMatch(/must test something/)
  })
})

describe('effects — wardrobe gestures', () => {
  const issuesOf = (doc: unknown): string => {
    const result = QtapCustomToolSchema.safeParse(doc)
    return result.success ? '' : formatDefinitionIssues(result.error)
  }

  it('accepts each action in its own shape', () => {
    expect(
      accepts(
        withEffects([
          { wardrobe: { action: 'wear', items: ['Cloak of Night'] } },
          { wardrobe: { action: 'wear', items: ['Ribbon'], mode: 'add_to_slot', slot: 'hair' } },
          { wardrobe: { action: 'wear', items: ['Regalia'], mode: 'replace' } },
          { when: { outcome: { eq: 'failure' } }, wardrobe: { action: 'take_off', items: ['Sundress'] } },
          { wardrobe: { action: 'take_off', items: ['Sundress'], slot: 'top' } },
          { wardrobe: { action: 'clear_slot', slot: 'hair' } },
        ])
      )
    ).toBe(true)
  })

  it('accepts a parameter choosing the garment', () => {
    expect(
      accepts(withEffects([{ wardrobe: { action: 'wear', items: ['{{params.material}} gloves'] } }], STR_PARAM))
    ).toBe(true)
  })

  it('tolerates an unknown placeholder family — it simply fails to resolve at the table', () => {
    expect(accepts(withEffects([{ wardrobe: { action: 'wear', items: ['{{mystery}}'] } }]))).toBe(true)
  })

  it('rejects an effect that is both a write and a gesture, or neither', () => {
    expect(
      rejection(withEffects([{ target: 'state.x', value: 1, wardrobe: { action: 'clear_slot', slot: 'hair' } }]))
    ).toMatch(/exactly one of/)
    expect(rejection(withEffects([{}]))).toMatch(/needs target \+ value, wardrobe, inventory, or log/)
    expect(rejection(withEffects([{ target: 'state.x' }]))).toMatch(/needs both target and value/)
  })

  it('states the per-action rules at precise paths', () => {
    expect(issuesOf(withEffects([{ wardrobe: { action: 'wear', items: ['Hat'], mode: 'add_to_slot' } }]))).toMatch(
      /effects\.0\.wardrobe\.slot.*mode add_to_slot needs a slot/
    )
    expect(issuesOf(withEffects([{ wardrobe: { action: 'wear', items: ['Hat'], slot: 'hair' } }]))).toMatch(
      /effects\.0\.wardrobe\.slot.*only used with mode add_to_slot/
    )
    expect(issuesOf(withEffects([{ wardrobe: { action: 'wear' } }]))).toMatch(/effects\.0\.wardrobe\.items.*at least one item/)
    expect(issuesOf(withEffects([{ wardrobe: { action: 'take_off', items: ['Hat'], mode: 'replace' } }]))).toMatch(
      /effects\.0\.wardrobe\.mode/
    )
    expect(issuesOf(withEffects([{ wardrobe: { action: 'clear_slot' } }]))).toMatch(/clear_slot needs a slot/)
    expect(issuesOf(withEffects([{ wardrobe: { action: 'clear_slot', slot: 'hair', items: ['Wig'] } }]))).toMatch(
      /effects\.0\.wardrobe\.items.*takes no items/
    )
  })

  it('rejects an item naming an undeclared parameter, or {{llm}} without a consult', () => {
    expect(issuesOf(withEffects([{ wardrobe: { action: 'wear', items: ['Hat', '{{params.ghost}}'] } }]))).toMatch(
      /effects\.0\.wardrobe\.items\.1.*undeclared parameter "ghost"/
    )
    expect(rejection(withEffects([{ wardrobe: { action: 'wear', items: ['{{llm}}'] } }]))).toMatch(
      /declares no `llm` block/
    )
    expect(accepts(withEffects([{ wardrobe: { action: 'wear', items: ['{{llm}}'] } }], LLM_BLOCK))).toBe(true)
  })

  it('rejects an over-long item list or reference', () => {
    const nine = Array.from({ length: 9 }, (_, i) => `Item ${i}`)
    expect(accepts(withEffects([{ wardrobe: { action: 'wear', items: nine } }]))).toBe(false)
    expect(accepts(withEffects([{ wardrobe: { action: 'wear', items: ['x'.repeat(201)] } }]))).toBe(false)
  })

  it('counts gestures and writes together against the effects cap', () => {
    const many = Array.from({ length: MAX_EFFECTS + 1 }, (_, i) =>
      i % 2 ? { target: `state.k${i}`, value: 1 } : { wardrobe: { action: 'clear_slot', slot: 'hair' } }
    )
    expect(accepts(withEffects(many))).toBe(false)
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

describe('when — contains and ncontains', () => {
  const BOTH_PARAMS = { parameters: { ...STR_PARAM.parameters, ...NUM_PARAM.parameters } }

  it('accepts contains against a string parameter', () => {
    expect(accepts(withWhen({ params: { material: { contains: 'ras' } } }, STR_PARAM))).toBe(true)
  })

  it('accepts ncontains against a string parameter', () => {
    expect(accepts(withWhen({ params: { material: { ncontains: 'iron' } } }, STR_PARAM))).toBe(true)
  })

  it('accepts a $param substring — one input sought inside another', () => {
    const params = {
      parameters: {
        cargo: { type: 'string', default: 'silk' },
        sought: { type: 'string', default: 'opium' },
      },
    }
    expect(accepts(withWhen({ params: { cargo: { contains: { $param: 'sought' } } } }, params))).toBe(true)
  })

  it('accepts contains on a metadata key', () => {
    expect(accepts(withWhen({ metadata: { faction: { contains: 'Aurum' } } }))).toBe(true)
  })

  it('accepts contains on the llm answer', () => {
    expect(accepts(withWhen({ llm: { contains: 'west door' } }, LLM_BLOCK))).toBe(true)
  })

  it('rejects contains against a numeric parameter — a number holds no substrings', () => {
    expect(rejection(withWhen({ params: { scale: { contains: '1' } } }, NUM_PARAM))).toMatch(
      /only a string can contain a substring/
    )
  })

  it('rejects contains on the bare value', () => {
    expect(accepts(withWhen({ contains: 'x' }))).toBe(false)
  })

  it('rejects contains on the raw roll', () => {
    expect(accepts(withWhen({ roll: { contains: 'x' } }))).toBe(false)
  })

  it('rejects an empty substring — everything contains ""', () => {
    expect(accepts(withWhen({ params: { material: { contains: '' } } }, STR_PARAM))).toBe(false)
  })

  it('rejects a number literal as the substring', () => {
    expect(accepts(withWhen({ params: { material: { contains: 42 } } }, STR_PARAM))).toBe(false)
  })

  it('rejects a $param substring referencing a numeric parameter', () => {
    expect(
      rejection(withWhen({ params: { material: { contains: { $param: 'scale' } } } }, BOTH_PARAMS))
    ).toMatch(/a substring must be a string/)
  })

  it('rejects a $param substring naming an undeclared parameter', () => {
    expect(rejection(withWhen({ params: { material: { contains: { $param: 'ghost' } } } }, STR_PARAM))).toMatch(
      /references undeclared parameter "ghost"/
    )
  })
})

describe('when — the llm subject', () => {
  it('accepts an answer test on a tool with an llm block', () => {
    expect(accepts(withWhen({ llm: { eq: 'YES' } }, LLM_BLOCK))).toBe(true)
  })

  it('accepts an ok test as the only test', () => {
    expect(accepts(withWhen({ llm: { ok: false } }, LLM_BLOCK))).toBe(true)
  })

  it('accepts ok ANDed with an answer comparator', () => {
    expect(accepts(withWhen({ llm: { ok: true, eq: 'YES' } }, LLM_BLOCK))).toBe(true)
  })

  it('accepts an ordering test — the answer may well be a number', () => {
    expect(accepts(withWhen({ llm: { gte: 5 } }, LLM_BLOCK))).toBe(true)
  })

  it('accepts a $param operand against the answer — the opposed check', () => {
    expect(accepts(withWhen({ llm: { eq: { $param: 'scale' } } }, { ...NUM_PARAM, ...LLM_BLOCK }))).toBe(true)
  })

  it('rejects an llm test on a tool with no llm block', () => {
    expect(rejection(withWhen({ llm: { eq: 'YES' } }))).toContain('declares no `llm` block')
  })

  it('rejects an empty llm comparator', () => {
    expect(accepts(withWhen({ llm: {} }, LLM_BLOCK))).toBe(false)
  })

  it('rejects a $param operand naming an undeclared parameter', () => {
    expect(rejection(withWhen({ llm: { eq: { $param: 'ghost' } } }, LLM_BLOCK))).toContain('undeclared parameter "ghost"')
  })

  it('rejects a misspelled comparator inside an llm test', () => {
    expect(accepts(withWhen({ llm: { eq: 'a', gt3: 1 } }, LLM_BLOCK))).toBe(false)
  })
})

describe('the llm block', () => {
  it('accepts a prompt and an errorMessage', () => {
    expect(accepts({ ...BASE, ...LLM_BLOCK })).toBe(true)
  })

  it('rejects a block missing its errorMessage — failure must have the author\'s words', () => {
    expect(accepts({ ...BASE, llm: { prompt: 'Speak.' } })).toBe(false)
  })

  it('rejects an empty prompt', () => {
    expect(accepts({ ...BASE, llm: { prompt: '', errorMessage: 'Silence.' } })).toBe(false)
  })

  it('rejects an unknown key inside the block', () => {
    expect(accepts({ ...BASE, llm: { prompt: 'Speak.', errorMessage: 'Silence.', model: 'gpt' } })).toBe(false)
  })

  it('accepts a maxOutput within bounds', () => {
    expect(accepts({ ...BASE, llm: { prompt: 'Speak.', errorMessage: 'Silence.', maxOutput: 50_000 } })).toBe(true)
  })

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['fractional', 12.5],
    ['past the ceiling', 100_001],
  ])('rejects a maxOutput that is %s', (_label, maxOutput) => {
    expect(accepts({ ...BASE, llm: { prompt: 'Speak.', errorMessage: 'Silence.', maxOutput } })).toBe(false)
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
    ['an llm block', { ...BASE, ...LLM_BLOCK }],
    ['an llm block missing its errorMessage', { ...BASE, llm: { prompt: 'Speak.' } }],
    ['an llm block with an empty prompt', { ...BASE, llm: { prompt: '', errorMessage: 'Silence.' } }],
    ['an unknown key inside the llm block', { ...BASE, llm: { prompt: 'Speak.', errorMessage: 'Silence.', model: 'x' } }],
    ['an intervention block', { ...BASE, intervention: { enabled: true } }],
    ['an intervention block with field flags', { ...BASE, intervention: { enabled: false, fields: { roll: false, llmPrompt: true } } }],
    ['an intervention block without enabled', { ...BASE, intervention: {} }],
    ['an unknown intervention field key', { ...BASE, intervention: { enabled: true, fields: { dice: false } } }],
    ['an unknown key inside the intervention block', { ...BASE, intervention: { enabled: true, always: true } }],
    ['a non-boolean intervention flag', { ...BASE, intervention: { enabled: true, fields: { roll: 'no' } } }],
    ['an intervene flag on a parameter', { ...BASE, parameters: { bonus: { type: 'number', default: 0, intervene: false } } }],
    ['an intervene flag on an effect', { ...BASE, effects: [{ target: 'state.n', value: 1, intervene: false }] }],
    ['an llm answer test', withWhen({ llm: { eq: 'YES' } }, LLM_BLOCK)],
    ['an llm ok test', withWhen({ llm: { ok: false } }, LLM_BLOCK)],
    ['ok ANDed with an answer comparator', withWhen({ llm: { ok: true, eq: 'YES' } }, LLM_BLOCK)],
    ['an ordering test of the llm answer', withWhen({ llm: { gte: 5 } }, LLM_BLOCK)],
    ['an empty llm comparator', withWhen({ llm: {} }, LLM_BLOCK)],
    ['an unknown key inside an llm comparator', withWhen({ llm: { eq: 'a', gt3: 1 } }, LLM_BLOCK)],
    ['a $param operand against the llm answer', withWhen({ llm: { eq: { $param: 'scale' } } }, { ...NUM_PARAM, ...LLM_BLOCK })],
    ['contains against a string parameter', withWhen({ params: { material: { contains: 'ras' } } }, STR_PARAM)],
    ['ncontains against a string parameter', withWhen({ params: { material: { ncontains: 'iron' } } }, STR_PARAM)],
    ['a $param substring operand', withWhen({ llm: { contains: { $param: 'material' } } }, { ...STR_PARAM, ...LLM_BLOCK })],
    ['contains on a metadata key', withWhen({ metadata: { faction: { contains: 'Aurum' } } })],
    ['contains on the llm answer', withWhen({ llm: { contains: 'west door' } }, LLM_BLOCK)],
    ['contains on the bare value', withWhen({ contains: 'x' })],
    ['contains on the raw roll', withWhen({ roll: { contains: 'x' } })],
    ['an empty substring', withWhen({ params: { material: { contains: '' } } }, STR_PARAM)],
    ['a number literal as the substring', withWhen({ params: { material: { contains: 42 } } }, STR_PARAM)],
    ['an llm maxOutput within bounds', { ...BASE, llm: { ...LLM_BLOCK.llm, maxOutput: 50_000 } }],
    ['an llm maxOutput of zero', { ...BASE, llm: { ...LLM_BLOCK.llm, maxOutput: 0 } }],
    ['a fractional llm maxOutput', { ...BASE, llm: { ...LLM_BLOCK.llm, maxOutput: 12.5 } }],
    ['an llm maxOutput past the ceiling', { ...BASE, llm: { ...LLM_BLOCK.llm, maxOutput: 100_001 } }],
    ['a templated chipLabel', { ...BASE, chipLabel: 'Agent lambda — {{params.label}}' }],
    ['an empty chipLabel', { ...BASE, chipLabel: '' }],
    ['an over-long chipLabel', { ...BASE, chipLabel: 'x'.repeat(MAX_CHIP_LABEL_LENGTH + 1) }],
    ['a literal-number effect', withEffects([{ target: 'state.encounter.count', value: 3 }])],
    ['a boolean-literal effect', withEffects([{ target: 'metadata.lockBroken', value: true }])],
    ['a quoted-string-expression effect', withEffects([{ target: 'metadata.lockpick', value: "'broken pick'" }])],
    ['an effect conditioned on the winning outcome', withEffects([{ when: { outcome: { eq: 'success' } }, target: 'state.wins', value: 1 }])],
    ['an effect conditioned on metadata', withEffects([{ when: { metadata: { hasKey: { eq: true } } }, target: 'state.opened', value: true }])],
    ['an effect with an empty value string', withEffects([{ target: 'state.x', value: '' }])],
    ['an effect with an over-long value string', withEffects([{ target: 'state.x', value: `'${'x'.repeat(500)}'` }])],
    ['an effect with an empty target', withEffects([{ target: '', value: 1 }])],
    ['an unknown key inside an effect', withEffects([{ target: 'state.x', value: 1, bogus: true }])],
    ['an empty outcome condition on an effect', withEffects([{ when: { outcome: {} }, target: 'state.x', value: 1 }])],
    ['an unknown outcome state in an effect condition', withEffects([{ when: { outcome: { eq: 'triumph' } }, target: 'state.x', value: 1 }])],
    ['an outcome subject inside an effect condition ANDed with a value test', withEffects([{ when: { gt: 0.5, outcome: { neq: 'failure' } }, target: 'state.x', value: 1 }])],
    ['a trigger list', { ...BASE, triggers: ['abracadabra', 'open sesame'] }],
    ['an empty trigger list', { ...BASE, triggers: [] }],
    ['a too-short trigger', { ...BASE, triggers: ['ok'] }],
    ['an over-long trigger', { ...BASE, triggers: ['x'.repeat(81)] }],
    ['more triggers than the cap', { ...BASE, triggers: Array.from({ length: 9 }, (_, i) => `phrase ${i}`) }],
    ['an exact duplicate trigger', { ...BASE, triggers: ['abracadabra', 'abracadabra'] }],
    ['a wardrobe wear effect', withEffects([{ wardrobe: { action: 'wear', items: ['Cloak of Night', 'Boots'] } }])],
    ['a wardrobe take_off restricted to a slot', withEffects([{ when: { outcome: { eq: 'failure' } }, wardrobe: { action: 'take_off', items: ['Sundress'], slot: 'top' } }])],
    ['a wardrobe clear_slot effect', withEffects([{ wardrobe: { action: 'clear_slot', slot: 'hair' } }])],
    ['an effect with both a target and a wardrobe gesture', withEffects([{ target: 'state.x', value: 1, wardrobe: { action: 'clear_slot', slot: 'hair' } }])],
    ['an empty effect', withEffects([{}])],
    ['a write with no value', withEffects([{ target: 'state.x' }])],
    ['a wardrobe gesture with an unknown action', withEffects([{ wardrobe: { action: 'dress', items: ['Hat'] } }])],
    ['a wardrobe gesture with an unknown slot', withEffects([{ wardrobe: { action: 'clear_slot', slot: 'gloves' } }])],
    ['a wardrobe gesture with an empty item list', withEffects([{ wardrobe: { action: 'wear', items: [] } }])],
    ['a wardrobe gesture with an unknown key', withEffects([{ wardrobe: { action: 'clear_slot', slot: 'hair', who: 'Bob' } }])],
    ['more effects than the cap', withEffects(Array.from({ length: MAX_EFFECTS + 1 }, (_, i) => ({ target: `state.k${i}`, value: 1 })))],
    ['an inventory state test', withWhen({ inventory: { sword: { eq: 'equipped' } } })],
    ['an inventory state test with gt', withWhen({ inventory: { sword: { gt: 1 } } })],
    ['an inventory state test against an unknown state', withWhen({ inventory: { sword: { eq: 'worn' } } })],
    ['an empty inventory comparator', withWhen({ inventory: { sword: {} } })],
    ['an inventory count test', withWhen({ inventoryCount: { ring: { gte: 2 } } })],
    ['an inventory count test with contains', withWhen({ inventoryCount: { ring: { contains: 'x' } } })],
    ['an inventory state $param to a string parameter', withWhen({ inventory: { sword: { eq: { $param: 'material' } } } }, STR_PARAM)],
    ['a templated inventory key', withWhen({ inventory: { '{{params.material}}': { neq: 'absent' } } }, STR_PARAM)],
    ['an inventory gate', { ...BASE, availableWhen: { inventory: { sword: { eq: 'equipped' } } } }],
    ['an inventory count gate', { ...BASE, withheldWhen: { inventoryCount: { ring: { gt: 0 } } } }],
    ['a $param inside an inventory gate', { ...BASE, availableWhen: { inventory: { sword: { eq: { $param: 'material' } } } }, ...STR_PARAM }],
    ['a roll drawn from $inventory', { ...BASE, roll: { $inventory: 'sword.metadata.damage', fallback: '1d4' } }],
    ['a range field drawn from $inventory', { ...BASE, roll: { min: 0, max: { $inventory: 'sword.metadata.reach', fallback: 1 } } }],
    ['a $inventory with no metadata segment', { ...BASE, roll: { $inventory: 'sword.title', fallback: '1d4' } }],
    ['a $inventory operand', withWhen({ gte: { $inventory: 'sword.metadata.bonus', fallback: 0 } })],
    ['a $inventory in a gate', { ...BASE, availableWhen: { metadata: { level: { gte: { $inventory: 'sword.metadata.level', fallback: 1 } } } } }],
    ['a $inventory parameter default', { ...BASE, parameters: { bonus: { type: 'number', default: { $inventory: 'sword.metadata.bonus', fallback: 0 } } } }],
    ['an inventory equip effect', withEffects([{ inventory: { action: 'equip', items: ['Excalibur'] } }])],
    ['an inventory pick_up effect with equip', withEffects([{ inventory: { action: 'pick_up', items: ['magic bow'], equip: false } }])],
    ['an inventory effect with an unknown action', withEffects([{ inventory: { action: 'give', items: ['lantern'] } }])],
    ['an inventory effect with no items', withEffects([{ inventory: { action: 'equip', items: [] } }])],
    ['an effect with both a wardrobe and an inventory gesture', withEffects([{ wardrobe: { action: 'clear_slot', slot: 'hair' }, inventory: { action: 'equip', items: ['x'] } }])],
    ['an effect with both a target and an inventory gesture', withEffects([{ target: 'state.x', value: 1, inventory: { action: 'equip', items: ['x'] } }])],
    ['an inventoryAggregate list test', withWhen({ inventoryAggregate: { 'equipped.names': { eq: 'ansible resonator' } } })],
    ['an inventoryAggregate fold test', withWhen({ inventoryAggregate: { 'equipped.metadata.toolVersion.max': { gte: 4 } } })],
    ['an inventoryAggregate count test', withWhen({ inventoryAggregate: { 'reachable.count': { gt: 0 } } })],
    ['an inventoryAggregate with a $param operand', withWhen({ inventoryAggregate: { 'owned.titles': { contains: { $param: 'material' } } } }, STR_PARAM)],
    ['an inventoryAggregate key with no scope', withWhen({ inventoryAggregate: { 'carried.names': { eq: 'x' } } })],
    ['an inventoryAggregate key with no field', withWhen({ inventoryAggregate: { 'equipped.': { eq: 'x' } } })],
    ['an inventoryAggregate key with an unknown field', withWhen({ inventoryAggregate: { 'equipped.weight': { gt: 1 } } })],
    ['an empty inventoryAggregate object', withWhen({ inventoryAggregate: {} })],
    ['an inventoryAggregate gate', { ...BASE, availableWhen: { inventoryAggregate: { 'equipped.metadata.toolAbilities': { contains: 'suppress' } } } }],
    ['a $param inside an inventoryAggregate gate', { ...BASE, ...STR_PARAM, availableWhen: { inventoryAggregate: { 'equipped.names': { eq: { $param: 'material' } } } } }],
    ['an any-of outcome', withWhen([{ gte: 0.9 }, { inventory: { 'lucky charm': { eq: 'equipped' } } }])],
    ['a one-element any-of outcome', withWhen([{ gte: 0.9 }])],
    ['an empty any-of outcome', withWhen([])],
    ['a nested any-of outcome', withWhen([[{ gte: 0.9 }]])],
    ['an any-of outcome with an empty group', withWhen([{ gte: 0.9 }, {}])],
    ['an any-of outcome past the cap', withWhen(Array.from({ length: MAX_WHEN_GROUPS + 1 }, (_, i) => ({ gte: i })))],
    ['an any-of gate', { ...BASE, availableWhen: [{ metadata: { a: { eq: true } } }, { metadata: { b: { eq: true } } }] }],
    ['an empty any-of gate', { ...BASE, withheldWhen: [] }],
    ['an any-of gate with an empty group', { ...BASE, withheldWhen: [{ metadata: { a: { eq: 1 } } }, {}] }],
    ['an any-of effect condition', withEffects([{ when: [{ outcome: { eq: 'success' } }, { metadata: { lucky: { eq: true } } }], target: 'state.x', value: 1 }])],
    ['an empty any-of effect condition', withEffects([{ when: [], target: 'state.x', value: 1 }])],
    ['an effect condition with an inventoryAggregate', withEffects([{ when: { inventoryAggregate: { 'owned.count': { gte: 3 } } }, log: 'Encumbered' }])],
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

  it('is deliberately weaker than Zod on an llm test with no llm block', () => {
    // Same class of divergence: whether the tool declares an `llm` block is a
    // cross-item fact the mirror cannot see from inside a `when`.
    const orphanLlmTest = withWhen({ llm: { eq: 'YES' } })
    expect(validate(orphanLlmTest)).toBe(true)
    expect(accepts(orphanLlmTest)).toBe(false)
  })

  it('is deliberately weaker than Zod on containment against a numeric parameter', () => {
    // Same class again: which type the named parameter declares is a
    // cross-item fact, so the mirror cannot know a number is being searched.
    const numericHaystack = withWhen({ params: { scale: { contains: '1' } } }, NUM_PARAM)
    expect(validate(numericHaystack)).toBe(true)
    expect(accepts(numericHaystack)).toBe(false)
  })

  it('is deliberately weaker than Zod on the effect expression grammar', () => {
    // The grammar lives in the loader's parser; the mirror can only say
    // "non-empty string ≤ 500" and describe the language in prose. So the
    // bare-prose quoting trap is caught by Zod alone.
    const bareProse = withEffects([{ target: 'metadata.lockpick', value: 'broken pick' }])
    expect(validate(bareProse)).toBe(true)
    expect(accepts(bareProse)).toBe(false)
  })

  it('is deliberately weaker than Zod on effect target syntax', () => {
    // The prefix rule and the underscore guard are the loader's parser too.
    const badPrefix = withEffects([{ target: 'somewhere.else', value: 1 }])
    const userOnly = withEffects([{ target: 'state._secrets.combo', value: 1 }])
    expect(validate(badPrefix)).toBe(true)
    expect(accepts(badPrefix)).toBe(false)
    expect(validate(userOnly)).toBe(true)
    expect(accepts(userOnly)).toBe(false)
  })

  it('is deliberately weaker than Zod on wardrobe per-action rules', () => {
    // Which fields an action needs is stated in the WardrobeGesture
    // description and enforced by the loader; the mirror checks shapes only.
    const addToSlotNoSlot = withEffects([{ wardrobe: { action: 'wear', items: ['Hat'], mode: 'add_to_slot' } }])
    const clearSlotWithItems = withEffects([{ wardrobe: { action: 'clear_slot', slot: 'hair', items: ['Wig'] } }])
    const ghostGarment = withEffects([{ wardrobe: { action: 'wear', items: ['{{params.ghost}}'] } }])
    for (const doc of [addToSlotNoSlot, clearSlotWithItems, ghostGarment]) {
      expect(validate(doc)).toBe(true)
      expect(accepts(doc)).toBe(false)
    }
  })

  it('is deliberately weaker than Zod on trigger case-folding and whitespace', () => {
    // JSON Schema's uniqueItems is case-sensitive and it has no trim rule; both
    // are stated in the `triggers` description and enforced by the loader.
    const caseDuplicate = { ...BASE, triggers: ['Abracadabra', 'abracadabra'] }
    const padded = { ...BASE, triggers: [' abracadabra'] }
    expect(validate(caseDuplicate)).toBe(true)
    expect(accepts(caseDuplicate)).toBe(false)
    expect(validate(padded)).toBe(true)
    expect(accepts(padded)).toBe(false)
  })

  it('is deliberately weaker than Zod on effect cross-item rules', () => {
    // Undeclared params and a missing llm block are cross-item facts the
    // mirror cannot see from inside an effect.
    const ghostParam = withEffects([{ target: 'state.x', value: '{{params.ghost}} + 1' }])
    const orphanLlm = withEffects([{ target: 'metadata.verdict', value: '{{llm}}' }])
    expect(validate(ghostParam)).toBe(true)
    expect(accepts(ghostParam)).toBe(false)
    expect(validate(orphanLlm)).toBe(true)
    expect(accepts(orphanLlm)).toBe(false)
  })
})

describe('the Inventory subjects, operand and effect', () => {
  const issues = (doc: unknown): string => {
    const result = QtapCustomToolSchema.safeParse(doc)
    return result.success ? '' : formatDefinitionIssues(result.error)
  }
  const NUMBER_ARG = { parameters: { scale: { type: 'number', default: 1 } } }

  it('rejects an inventory state $param to a number parameter', () => {
    expect(issues(withWhen({ inventory: { sword: { eq: { $param: 'scale' } } } }, NUMBER_ARG))).toMatch(
      /outcomes\.0\.when\.inventory\.sword\.eq.*rather than a string/
    )
  })

  it('rejects an ordering key on a state, and containment on a count', () => {
    expect(issues(withWhen({ inventory: { sword: { gt: 1 } } }))).not.toBe('')
    expect(issues(withWhen({ inventoryCount: { ring: { contains: 'x' } } }))).not.toBe('')
  })

  it('rejects a placeholder in a gate key, and accepts one in an outcome key', () => {
    expect(issues({ ...BASE, ...NUMBER_ARG, availableWhen: { inventory: { '{{params.scale}}': { eq: 'equipped' } } } })).toMatch(
      /availableWhen\.inventory.*must be a literal object reference/
    )
    expect(issues(withWhen({ inventory: { '{{params.scale}}': { eq: 'equipped' } } }, NUMBER_ARG))).toBe('')
    expect(issues(withWhen({ inventory: { '{{params.ghost}}': { eq: 'equipped' } } }))).toMatch(/undeclared parameter "ghost"/)
  })

  it('types $inventory by its fallback, and demands dice for a whole roll', () => {
    expect(issues({ ...BASE, roll: { $inventory: 'sword.metadata.damage', fallback: '1d4' } })).toBe('')
    expect(issues({ ...BASE, roll: { $inventory: 'sword.metadata.damage', fallback: 4 } })).toMatch(/dice-notation fallback/)
    expect(issues({ ...BASE, roll: { max: { $inventory: 'sword.metadata.reach', fallback: 'far' } } })).toMatch(
      /\$inventory reference whose fallback is string rather than a number/
    )
    expect(issues(withWhen({ gte: { $inventory: 'sword.metadata.bonus', fallback: 'x' } }))).toMatch(/only numbers can be ordered/)
  })

  it('rejects $inventory in a gate, as $state is', () => {
    expect(issues({ ...BASE, availableWhen: { metadata: { level: { gte: { $inventory: 'sword.metadata.level', fallback: 1 } } } } })).not.toBe('')
  })

  it('states the gesture rules at precise paths', () => {
    expect(issues(withEffects([{ inventory: { action: 'equip', items: ['x'], equip: true } }]))).toMatch(
      /effects\.0\.inventory\.equip.*only used with pick_up/
    )
    expect(issues(withEffects([{ inventory: { action: 'equip', items: ['{{params.ghost}}'] } }]))).toMatch(
      /effects\.0\.inventory\.items\.0.*undeclared parameter/
    )
  })
})

describe('triggers', () => {
  const issues = (doc: unknown): string => {
    const result = QtapCustomToolSchema.safeParse(doc)
    return result.success ? '' : formatDefinitionIssues(result.error)
  }

  it('stores phrases as written', () => {
    const parsed = QtapCustomToolSchema.parse({ ...BASE, triggers: ['Open Sesame'] })
    expect(parsed.triggers).toEqual(['Open Sesame'])
  })

  it('rejects leading or trailing whitespace, naming the trigger', () => {
    expect(issues({ ...BASE, triggers: ['abracadabra', 'open sesame '] })).toContain(
      'trigger 2 has leading or trailing whitespace',
    )
  })

  it('rejects a phrase that repeats another ignoring case', () => {
    expect(issues({ ...BASE, triggers: ['Abracadabra', 'ABRACADABRA'] })).toContain('trigger 2 repeats trigger 1')
  })

  it('is a known top-level key', () => {
    expect(KNOWN_TOP_LEVEL_KEYS).toContain('triggers')
  })
})

describe('effects — log lines', () => {
  const issuesOf = (doc: unknown): string => {
    const result = QtapCustomToolSchema.safeParse(doc)
    return result.success ? '' : formatDefinitionIssues(result.error)
  }

  it('accepts a log line, with or without a condition', () => {
    expect(accepts(withEffects([{ log: 'Rolled {{value}} on the lock' }]))).toBe(true)
    expect(accepts(withEffects([{ when: { outcome: { eq: 'success' } }, log: 'Opened' }]))).toBe(true)
  })

  it('rejects a log line beside any other kind', () => {
    expect(rejection(withEffects([{ log: 'x', target: 'state.x', value: 1 }]))).toMatch(/exactly one of/)
    expect(rejection(withEffects([{ log: 'x', inventory: { action: 'equip', items: ['Lamp'] } }]))).toMatch(
      /exactly one of/
    )
  })

  it('rejects an empty or over-long line', () => {
    expect(accepts(withEffects([{ log: '' }]))).toBe(false)
    expect(accepts(withEffects([{ log: 'x'.repeat(1001) }]))).toBe(false)
  })

  it('checks its placeholders as an outcome message’s are checked', () => {
    expect(issuesOf(withEffects([{ log: 'Opened {{params.ghost}}' }]))).toMatch(
      /effects\.0\.log.*undeclared parameter "ghost"/
    )
    expect(rejection(withEffects([{ log: 'Oracle: {{llm}}' }]))).toMatch(/declares no `llm` block/)
    expect(accepts(withEffects([{ log: 'Oracle: {{llm}}' }], LLM_BLOCK))).toBe(true)
  })
})

describe('inventoryAggregate and any-of', () => {
  it('accepts every aggregate key form and rejects the rest with the parser’s reason', () => {
    for (const key of [
      'equipped.count',
      'owned.names',
      'reachable.titles',
      'equipped.metadata.toolAbilities',
      'equipped.metadata.toolVersion.max',
      'owned.metadata.a.b',
    ]) {
      expect(accepts(withWhen({ inventoryAggregate: { [key]: { eq: 1 } } }))).toBe(true)
    }
    expect(rejection(withWhen({ inventoryAggregate: { 'carried.names': { eq: 'x' } } }))).toMatch(/not a scope/)
    expect(rejection(withWhen({ inventoryAggregate: { 'equipped.weight': { eq: 'x' } } }))).toMatch(/not a field/)
  })

  it('rejects a $param operand in an aggregate gate, and an undeclared one in an outcome', () => {
    expect(accepts({ ...BASE, ...STR_PARAM, availableWhen: { inventoryAggregate: { 'equipped.names': { eq: { $param: 'material' } } } } })).toBe(false)
    expect(rejection(withWhen({ inventoryAggregate: { 'equipped.names': { eq: { $param: 'ghost' } } } }))).toMatch(
      /undeclared parameter "ghost"/
    )
  })

  it('locates an issue inside an any-of group by its index', () => {
    expect(rejection(withWhen([{ gte: 0.9 }, { params: { ghost: { eq: 1 } } }]))).toMatch(/outcomes\.0\.when\.1\.params\.ghost/)
    expect(
      rejection({ ...BASE, ...STR_PARAM, withheldWhen: [{ metadata: { a: { eq: 1 } } }, { inventory: { '{{params.material}}': { eq: 'equipped' } } }] })
    ).toMatch(/withheldWhen\.1\.inventory.*must be a literal object reference/)
  })

  it('does not bury a group’s complaint under the array branch', () => {
    expect(rejection({ ...BASE, availableWhen: {} })).toMatch(/must test at least one/)
    expect(rejection({ ...BASE, availableWhen: {} })).not.toMatch(/expected array/)
  })

  it('keeps the catch-all rule: an array is never a catch-all', () => {
    expect(rejection({ ...BASE, outcomes: [{ when: [{ gte: 0.5 }], message: '-', state: 'info' }] })).toMatch(
      /final outcome must be a catch-all/
    )
  })
})

/**
 * Every reader of a gate or a `when` goes through `gateGroups` / `whenGroups`
 * / `effectWhenGroups`, so an any-of array can never be read as one group by
 * a site that forgot it could be an array. The types enforce most of it; this
 * holds the line for the rest.
 */
describe('no raw reads of a gate or a when', () => {
  const ROOTS = ['lib', 'app', 'components']
  const EXEMPT = new Set([
    path.join('lib', 'pascal', 'custom-tool.types.ts'),
    path.join('lib', 'pascal', 'tool-draft.ts'),
  ])
  const SUBJECTS = 'metadata|progress|inventory|inventoryCount|inventoryAggregate|params|roll|llm|outcome'
  const RAW = new RegExp(`(?:availableWhen|withheldWhen|\\.when)\\??\\.(?:${SUBJECTS})\\b`)

  function* walk(dir: string): Generator<string> {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) yield* walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name)) yield full
    }
  }

  it('finds none outside the schema and the draft model', () => {
    const repo = path.resolve(__dirname, '../../../..')
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of walk(path.join(repo, root))) {
        const relative = path.relative(repo, file)
        if (EXEMPT.has(relative)) continue
        fs.readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (RAW.test(line)) offenders.push(`${relative}:${i + 1}: ${line.trim()}`)
          })
      }
    }
    expect(offenders).toEqual([])
  })
})
