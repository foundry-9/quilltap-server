/**
 * The Workbench draft model and the Inventory (inventory-tools-and-pascal
 * §5.8): `inventory` / `inventoryCount` chips, gate chips, the inventory
 * effect kind and the `$inventory` roll all round-trip, and the draft check
 * says what the loader would.
 */

import {
  definitionFromDraft,
  draftFromDefinition,
  newDraftEffect,
  validateDraft,
  type ToolDraft,
} from '@/lib/pascal/tool-draft'
import { QtapCustomToolSchema } from '@/lib/pascal/custom-tool.types'

const TOOL = {
  name: 'strike',
  description: 'Strike.',
  parameters: { weapon: { type: 'string', default: 'Excalibur' } },
  availableWhen: { inventory: { lantern: { eq: 'equipped' } }, inventoryCount: { ring: { gte: 1 } } },
  roll: { $inventory: 'sword.metadata.damage', fallback: '1d4' },
  effects: [
    { inventory: { action: 'equip', items: ['{{params.weapon}}'] } },
    { when: { outcome: { eq: 'failure' } }, inventory: { action: 'pick_up', items: ['magic bow'], equip: false } },
  ],
  outcomes: [
    { when: { inventory: { '{{params.weapon}}': { eq: 'equipped' } }, inventoryCount: { ring: { gte: 2 } } }, message: 'hit', state: 'success' },
    { when: true, message: 'miss', state: 'failure' },
  ],
}

function load(doc: unknown): ToolDraft {
  const draft = draftFromDefinition(doc)
  if (!draft) throw new Error('fixture failed to load')
  return draft
}

describe('round trip', () => {
  it('serialises back to the same definition', () => {
    const draft = load(TOOL)
    expect(draft.rollForm).toBe('inventory')
    expect(draft.effects.map((e) => e.kind)).toEqual(['inventory', 'inventory'])
    const out = definitionFromDraft(draft)
    expect(out.roll).toEqual(TOOL.roll)
    expect(out.availableWhen).toEqual(TOOL.availableWhen)
    expect(out.effects).toEqual(TOOL.effects)
    expect((out.outcomes as Array<{ when: unknown }>)[0].when).toEqual(TOOL.outcomes[0].when)
    expect(QtapCustomToolSchema.safeParse(out).success).toBe(true)
    expect(validateDraft(draft).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('a fresh inventory effect emits only the active half', () => {
    const draft = load({ name: 'x', description: 'x', outcomes: [{ when: true, message: '-', state: 'info' }] })
    const effect = { ...newDraftEffect('inventory'), inventory: { action: 'pick_up' as const, items: ['bow', ''], equip: true } }
    draft.effects = [effect]
    expect(definitionFromDraft(draft).effects).toEqual([{ inventory: { action: 'pick_up', items: ['bow'] } }])
  })
})

describe('validation', () => {
  it('a state chip needs one of the four states, and only = or ≠', () => {
    const draft = load(TOOL)
    const chip = draft.outcomes[0].conditions.find((c) => c.subject.kind === 'inventory')!
    chip.operand = { kind: 'string', text: 'worn' }
    expect(validateDraft(draft).map((i) => i.message)).toContain('pick a state: equipped, carried, reachable or absent')
    chip.comparator = 'gt'
    expect(validateDraft(draft).map((i) => i.message)).toContain('an inventory state can only be tested with = or ≠')
  })

  it('a gate key may not carry a placeholder', () => {
    const draft = load(TOOL)
    draft.gateConditions[0].key = '{{params.weapon}}'
    expect(validateDraft(draft).map((i) => i.message)).toContain(
      'a gate is answered before any parameter exists — name the object literally'
    )
  })

  it('an inventory effect states the per-action rule and names undeclared parameters', () => {
    const draft = load(TOOL)
    draft.effects[0].inventory = { action: 'equip', items: ['{{params.ghost}}'], equip: true }
    expect(validateDraft(draft).map((i) => i.message)).toContain('{{params.ghost}} names no declared parameter')
    draft.effects[0].inventory = { action: 'equip', items: [''], equip: true }
    expect(validateDraft(draft).map((i) => i.message)).toContain('equip needs at least one object')
  })

  it('a $inventory roll needs an object path and dice to fall back on', () => {
    const draft = load(TOOL)
    draft.rollInventory = { path: 'sword.title', fallback: 'four' }
    const messages = validateDraft(draft).map((i) => i.message)
    expect(messages).toContain('name "<object>.metadata.<key>", e.g. "sword.metadata.damage"')
    expect(messages).toContain('the fallback must be dice notation like "1d4"')
  })
})

describe('any-of and inventoryAggregate (pascal-gate-broadening)', () => {
  const sortKeys = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sortKeys)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)]))
        : value

  const ANY_OF = {
    $schema: '/schemas/qtap-custom-tool.schema.json',
    name: 'tune',
    description: 'Tune.',
    parameters: { band: { type: 'string', default: 'low' } },
    availableWhen: [
      { metadata: { a: { eq: true } }, inventoryAggregate: { 'equipped.metadata.toolVersion.max': { gte: 4 } } },
      { metadata: { a: { eq: true } }, inventoryAggregate: { 'equipped.names': { eq: 'ansible resonator' } } },
    ],
    effects: [{ when: [{ outcome: { eq: 'success' } }, { metadata: { lucky: { eq: true } } }], target: 'state.tuned', value: true }],
    outcomes: [
      {
        when: [{ gte: 0.9 }, { inventory: { 'lucky charm': { eq: 'equipped' } }, inventoryAggregate: { 'owned.titles': { contains: { $param: 'band' } } } }],
        message: 'tuned',
        state: 'success',
      },
      { when: true, message: 'static', state: 'info' },
    ],
  }

  it('round-trips an any-of gate, outcome and effect byte-equal after key sort', () => {
    const draft = load(ANY_OF)
    expect(draft.gateConditions.map((c) => c.joiner ?? 'and')).toEqual(['and', 'and', 'or', 'and'])
    expect(draft.outcomes[0].conditions.map((c) => c.joiner ?? 'and')).toEqual(['and', 'or', 'and'])
    expect(draft.effects[0].when.kind).toBe('verbatim')
    const out = definitionFromDraft(draft)
    expect(JSON.stringify(sortKeys(out))).toBe(JSON.stringify(sortKeys(QtapCustomToolSchema.parse(ANY_OF))))
    expect(validateDraft(draft).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('collapses a single line to a bare object, and drops a line of incomplete chips', () => {
    const draft = load(ANY_OF)
    draft.gateConditions = draft.gateConditions.map((c) => ({ ...c, joiner: 'and' as const }))
    expect(Array.isArray(definitionFromDraft(draft).availableWhen)).toBe(false)
    draft.outcomes[0].conditions = draft.outcomes[0].conditions.slice(0, 1)
    expect((definitionFromDraft(draft).outcomes as Array<{ when: unknown }>)[0].when).toEqual({ gte: 0.9 })
  })

  it('lets two lines repeat a slot, but not one line', () => {
    const doc = {
      ...ANY_OF,
      availableWhen: [{ metadata: { rank: { gt: 3 } } }, { metadata: { rank: { gt: 5 } } }],
    }
    const draft = load(doc)
    expect(validateDraft(draft).filter((i) => i.severity === 'error')).toEqual([])
    draft.gateConditions = draft.gateConditions.map((c) => ({ ...c, joiner: 'and' as const }))
    expect(validateDraft(draft).map((i) => i.message)).toContain('a line of the gate can test this key with this comparator only once')
  })

  it.each([
    ['equipped.bag', { kind: 'number', text: '1' }, 'eq', /not a field/],
    ['equipped.names', { kind: 'number', text: '1' }, 'gt', /cannot order a list; fold it/],
    ['owned.metadata.tags', { kind: 'number', text: '1' }, 'lte', /cannot order a list; fold it/],
    ['equipped.count', { kind: 'string', text: 'x' }, 'contains', /a number holds no text/],
    ['equipped.metadata.v.max', { kind: 'string', text: 'x' }, 'ncontains', /a number holds no text/],
  ] as const)('flags %s with %s', (key, operand, comparator, message) => {
    const draft = load({ name: 'x', description: 'x', outcomes: [{ when: true, message: '-', state: 'info' }] })
    draft.gateMode = 'available'
    draft.gateConditions = [{ id: 'g1', subject: 'inventoryAggregate', key, comparator, operand }]
    expect(validateDraft(draft).filter((i) => i.severity === 'error').map((i) => i.message).join('\n')).toMatch(message)
  })

  it('warns that a metadata key ending in a fold word reads as the fold', () => {
    const draft = load({
      name: 'x', description: 'x',
      outcomes: [{ when: { inventoryAggregate: { 'owned.metadata.stats.max': { gte: 1 } } }, message: 'y', state: 'info' }, { when: true, message: '-', state: 'info' }],
    })
    const warnings = validateDraft(draft).filter((i) => i.severity === 'warning').map((i) => i.message)
    expect(warnings.join('\n')).toMatch(/reads as the \.max of metadata key "stats"/)
  })

  it('refuses a $param of the wrong type and a templated aggregate key', () => {
    const draft = load({
      name: 'x', description: 'x', parameters: { n: { type: 'number', default: 1 } },
      outcomes: [{ when: { inventoryAggregate: { 'equipped.names': { contains: { $param: 'n' } } } }, message: 'y', state: 'info' }, { when: true, message: '-', state: 'info' }],
    })
    expect(validateDraft(draft).map((i) => i.message).join('\n')).toMatch(/needs text to look for; "n" is number/)
    draft.outcomes[0].conditions[0].subject = { kind: 'inventoryAggregate', key: 'equipped.metadata.{{params.n}}' }
    expect(validateDraft(draft).map((i) => i.message).join('\n')).toMatch(/aggregate key is literal/)
  })
})
