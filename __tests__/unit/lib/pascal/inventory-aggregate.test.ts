/**
 * The `inventoryAggregate` subject (spec pascal-gate-broadening §5.1–5.3) and
 * the per-entry list rule in the one comparison table: the key parser, the
 * three cumulative scopes on a real context and on the bench's mock bag, the
 * folds, the per-entry comparators, the null context — and the gate read
 * through it, any-of included (§8 acceptance).
 */

import {
  aggregateValue,
  inventoryAggregateHolds,
  parseAggregateKey,
  type ParsedAggregateKey,
} from '@/lib/pascal/inventory-aggregate'
import { metadataComparatorHolds, type Primitive } from '@/lib/pascal/metadata-match'
import { mockInventoryContext } from '@/lib/pascal/bench-inventory'
import { evaluateToolGate } from '@/lib/pascal/tool-gate'
import { inventoryContextFrom, type InventoryContext } from '@/lib/inventory/refs'
import { QtapCustomToolSchema, type MetadataComparator, type QtapCustomTool } from '@/lib/pascal/custom-tool.types'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'

const T = '2026-10-20T00:00:00.000Z'
function obj(id: string, fields: Partial<ResolvedInventoryItem> = {}): ResolvedInventoryItem {
  return {
    id, kind: 'item', name: id, title: null, equippedByDefault: false, maxEquipped: 1, canCopy: false,
    isArchetype: false, parentId: null, itemIds: [], metadata: {}, folder: '', archivedAt: null, createdAt: T, updatedAt: T,
    ...fields,
  } as ResolvedInventoryItem
}

function ctxOf(items: ResolvedInventoryItem[], own: string[], equipped: string[]): InventoryContext {
  const owned = new Set(own)
  return inventoryContextFrom('c', 'chat', { items, owns: (id) => owned.has(id) }, new Set(equipped))
}

const literal = (comparator: MetadataComparator) => ({
  resolveOperand: (key: keyof MetadataComparator) => comparator[key] as Primitive,
})
const holds = (key: string, comparator: MetadataComparator, ctx: InventoryContext | null) =>
  inventoryAggregateHolds(comparator, key, ctx, literal(comparator))

function parsed(key: string): ParsedAggregateKey {
  const result = parseAggregateKey(key)
  if (!result.ok) throw new Error(result.reason)
  return result.parsed
}

function define(doc: unknown): QtapCustomTool {
  const result = QtapCustomToolSchema.safeParse(doc)
  if (!result.success) throw new Error(result.error.issues.map((i) => i.message).join('; '))
  return result.data
}

describe('parseAggregateKey', () => {
  it.each([
    ['equipped.count', { scope: 'equipped', field: { kind: 'count' } }],
    ['owned.names', { scope: 'owned', field: { kind: 'names' } }],
    ['reachable.titles', { scope: 'reachable', field: { kind: 'titles' } }],
    ['equipped.metadata.toolAbilities', { scope: 'equipped', field: { kind: 'metadata', key: 'toolAbilities' } }],
    ['equipped.metadata.toolVersion.max', { scope: 'equipped', field: { kind: 'metadata', key: 'toolVersion', fold: 'max' } }],
    ['owned.metadata.weight.sum', { scope: 'owned', field: { kind: 'metadata', key: 'weight', fold: 'sum' } }],
    ['owned.metadata.a.b', { scope: 'owned', field: { kind: 'metadata', key: 'a.b' } }],
    ['owned.metadata.a.b.min', { scope: 'owned', field: { kind: 'metadata', key: 'a.b', fold: 'min' } }],
    // A key that IS a fold word has nothing before it, so it is the key.
    ['owned.metadata.count', { scope: 'owned', field: { kind: 'metadata', key: 'count' } }],
  ])('parses %s', (key, expected) => {
    expect(parseAggregateKey(key)).toEqual({ ok: true, parsed: expected })
  })

  it.each([
    ['', /scope/],
    ['names', /scope/],
    ['carried.names', /not a scope/],
    ['equipped.', /not a field/],
    ['equipped.weight', /not a field/],
    ['equipped.metadata.', /not a field/],
    ['equipped.count.max', /not a field/],
  ])('rejects %s', (key, reason) => {
    const result = parseAggregateKey(key)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(reason)
  })
})

describe('scopeObjects on a real context', () => {
  const items = [
    obj('lockpick', { title: 'Lockpick', metadata: { toolAbilities: ['pick', 'probe'], toolVersion: 2 } }),
    obj('resonator', { name: 'ansible resonator', metadata: { toolAbilities: 'suppress, amplify', toolVersion: 4 } }),
    obj('spare', { name: 'spare pick', metadata: { toolVersion: 7 } }),
    obj('shelf-rope', { name: 'rope', origin: { scope: 'general', id: 'g', name: 'General' } } as Partial<ResolvedInventoryItem>),
    obj('template', { name: 'template', isArchetype: true, metadata: { toolVersion: 99 } }),
    obj('old', { name: 'old', archivedAt: T, metadata: { toolVersion: 99 } }),
    obj('kit', { name: 'kit', kind: 'kit', itemIds: ['lockpick'] }),
    // An instance resolved with its archetype's metadata already merged in.
    obj('inst', { name: 'template', parentId: 'template', metadata: { toolVersion: 5 } }),
  ]
  const ctx = ctxOf(items, ['lockpick', 'resonator', 'spare', 'template', 'old', 'kit', 'inst'], ['lockpick', 'resonator', 'kit'])

  it('is cumulative: equipped ⊆ owned ⊆ reachable', () => {
    const names = (scope: 'equipped' | 'owned' | 'reachable') => ctx.scopeObjects(scope).map((o) => o.name)
    expect(names('equipped')).toEqual(['lockpick', 'ansible resonator'])
    expect(names('owned')).toEqual(['lockpick', 'ansible resonator', 'spare pick', 'template'])
    expect(names('reachable')).toEqual(['lockpick', 'ansible resonator', 'spare pick', 'rope', 'template'])
  })

  it('never counts archetypes, archived objects or kits', () => {
    expect(holds('reachable.metadata.toolVersion.max', { lt: 99 }, ctx)).toBe(true)
    expect(holds('reachable.names', { neq: 'kit' }, ctx)).toBe(true)
  })

  it('reads titles as the title, else the name', () => {
    expect(ctx.scopeObjects('equipped').map((o) => o.title)).toEqual(['Lockpick', 'ansible resonator'])
  })

  it('carries an instance’s resolved metadata', () => {
    expect(holds('owned.metadata.toolVersion.max', { eq: 7 }, ctx)).toBe(true)
    expect(holds('owned.metadata.toolVersion.sum', { eq: 2 + 4 + 7 + 5 }, ctx)).toBe(true)
  })
})

describe('the mock bag', () => {
  const ctx = mockInventoryContext([
    { ref: 'Lockpick', state: 'equipped', count: 2, metadata: { toolVersion: 3 } },
    { ref: 'Resonator', state: 'carried', metadata: { toolAbilities: ['suppress'] } },
    { ref: 'Rope', state: 'reachable' },
    { ref: 'Ghost', state: 'absent', metadata: { toolVersion: 9 } },
  ])

  it('places rows by state and repeats an equipped row by its count', () => {
    expect(ctx.scopeObjects('equipped').map((o) => o.name)).toEqual(['Lockpick', 'Lockpick'])
    expect(ctx.scopeObjects('owned').map((o) => o.name)).toEqual(['Lockpick', 'Lockpick', 'Resonator'])
    expect(ctx.scopeObjects('reachable').map((o) => o.name)).toEqual(['Lockpick', 'Lockpick', 'Resonator', 'Rope'])
  })

  it('agrees with inventoryCount and folds the copies', () => {
    expect(ctx.equippedKinCount('lockpick')).toBe(2)
    expect(holds('equipped.count', { eq: 2 }, ctx)).toBe(true)
    expect(holds('equipped.metadata.toolVersion.sum', { eq: 6 }, ctx)).toBe(true)
    expect(holds('owned.metadata.toolAbilities', { eq: 'suppress' }, ctx)).toBe(true)
  })
})

describe('the folds', () => {
  const two = [
    { name: 'a', title: 'a', metadata: { toolVersion: 2 } },
    { name: 'b', title: 'b', metadata: { toolVersion: 4 } },
    { name: 'c', title: 'c', metadata: {} },
  ]
  const words = [
    { name: 'a', title: 'a', metadata: { toolVersion: 'beta' } },
    { name: 'b', title: 'b', metadata: { toolVersion: true } },
  ]

  it('folds the numbers among the objects carrying the key', () => {
    expect(aggregateValue(parsed('equipped.metadata.toolVersion.max'), two)).toBe(4)
    expect(aggregateValue(parsed('equipped.metadata.toolVersion.min'), two)).toBe(2)
    expect(aggregateValue(parsed('equipped.metadata.toolVersion.sum'), two)).toBe(6)
    expect(aggregateValue(parsed('equipped.metadata.toolVersion.count'), two)).toBe(2)
    expect(aggregateValue(parsed('equipped.count'), two)).toBe(3)
  })

  it('leaves min/max/sum absent with nothing numeric, and counts zero', () => {
    expect(aggregateValue(parsed('equipped.metadata.toolVersion.max'), words)).toBeUndefined()
    expect(aggregateValue(parsed('equipped.metadata.toolVersion.sum'), [])).toBeUndefined()
    expect(aggregateValue(parsed('equipped.metadata.toolVersion.count'), words)).toBe(0)
  })

  it('lists primitives and array entries, one level, skipping the rest', () => {
    const odd = [
      { name: 'a', title: 'a', metadata: { tags: ['x', 1, true, null, { y: 1 }, ['z']] } },
      { name: 'b', title: 'b', metadata: { tags: null } },
      { name: 'c', title: 'c', metadata: { tags: 'w' } },
    ]
    expect(aggregateValue(parsed('owned.metadata.tags'), odd)).toEqual(['x', 1, true, 'w'])
  })
})

describe('the per-entry rule, in the one table', () => {
  const sheet = { knownLanguages: ['Trade Cant', 'Latin'], empty: [], mixed: ['a', { b: 1 }], numbers: [1, 2] }
  const test = (key: string, comparator: MetadataComparator) =>
    metadataComparatorHolds(comparator, key, sheet, literal(comparator))

  it('eq when any entry equals; neq when none does', () => {
    expect(test('knownLanguages', { eq: 'Latin' })).toBe(true)
    expect(test('knownLanguages', { eq: 'latin' })).toBe(false)
    expect(test('knownLanguages', { neq: 'Greek' })).toBe(true)
    expect(test('knownLanguages', { neq: 'Latin' })).toBe(false)
    expect(test('numbers', { eq: 2 })).toBe(true)
  })

  it('contains when any string entry contains; ncontains when none does', () => {
    expect(test('knownLanguages', { contains: 'Cant' })).toBe(true)
    expect(test('knownLanguages', { ncontains: 'Greek' })).toBe(true)
    expect(test('knownLanguages', { ncontains: 'Cant' })).toBe(false)
    expect(test('numbers', { contains: '1' })).toBe(false)
  })

  it('declines ordering on a list', () => {
    const reasons: string[] = []
    expect(metadataComparatorHolds({ gt: 1 }, 'numbers', sheet, { ...literal({ gt: 1 }), onDecline: (r) => reasons.push(r) })).toBe(false)
    expect(reasons[0]).toMatch(/fold it/)
  })

  it('reads an empty list as a fact: eq declines, neq and ncontains hold', () => {
    expect(test('empty', { eq: 'x' })).toBe(false)
    expect(test('empty', { neq: 'x' })).toBe(true)
    expect(test('empty', { ncontains: 'x' })).toBe(true)
    expect(test('empty', { contains: 'x' })).toBe(false)
  })

  it('still declines a list holding anything but primitives, whole', () => {
    for (const comparator of [{ eq: 'a' }, { neq: 'z' }, { contains: 'a' }, { ncontains: 'z' }] as MetadataComparator[]) {
      expect(test('mixed', comparator)).toBe(false)
    }
  })
})

describe('inventoryAggregateHolds', () => {
  it('declines every test with no context, in both directions', () => {
    for (const comparator of [{ eq: 0 }, { neq: 'x' }, { ncontains: 'x' }, { lt: 1 }] as MetadataComparator[]) {
      expect(holds('equipped.count', comparator, null)).toBe(false)
      expect(holds('equipped.names', comparator, null)).toBe(false)
    }
  })

  it('reads an empty scope as a fact', () => {
    const empty = ctxOf([], [], [])
    expect(holds('equipped.count', { eq: 0 }, empty)).toBe(true)
    expect(holds('equipped.names', { eq: 'x' }, empty)).toBe(false)
    expect(holds('equipped.names', { neq: 'x' }, empty)).toBe(true)
    expect(holds('equipped.names', { ncontains: 'x' }, empty)).toBe(true)
    expect(holds('equipped.metadata.v.max', { gte: 0 }, empty)).toBe(false)
    expect(holds('equipped.metadata.v.max', { lt: 0 }, empty)).toBe(false)
  })

  it('declines a key that does not parse', () => {
    expect(holds('pocket.names', { eq: 'x' }, ctxOf([], [], []))).toBe(false)
  })
})

describe('§8 acceptance, through the gate', () => {
  const suppressor = (toolAbilities: unknown) => obj('suppressor', { metadata: { toolAbilities } })
  const gate = (scope: string) =>
    define({
      name: 'muffle',
      description: 'Muffle.',
      availableWhen: { inventoryAggregate: { [`${scope}.metadata.toolAbilities`]: { contains: 'suppress' } } },
      outcomes: [{ when: true, message: 'x', state: 'info' }],
    })
  const offered = (tool: QtapCustomTool, ctx: InventoryContext | null) => evaluateToolGate(tool, {}, undefined, ctx).available

  it.each([['a string', 'suppress, amplify'], ['a list', ['suppress', 'amplify']]])(
    'equipped: offers the tool for %s of abilities, only when equipped',
    (_label, abilities) => {
      const equipped = ctxOf([suppressor(abilities)], ['suppressor'], ['suppressor'])
      const stowed = ctxOf([suppressor(abilities)], ['suppressor'], [])
      const onTheShelf = ctxOf([suppressor(abilities)], [], [])
      expect(offered(gate('equipped'), equipped)).toBe(true)
      expect(offered(gate('equipped'), stowed)).toBe(false)
      expect(offered(gate('owned'), equipped)).toBe(true)
      expect(offered(gate('owned'), stowed)).toBe(true)
      expect(offered(gate('owned'), onTheShelf)).toBe(false)
      expect(offered(gate('reachable'), onTheShelf)).toBe(true)
    }
  )

  it('names match exactly, never by prefix or case', () => {
    const tool = define({
      name: 'tune',
      description: 'Tune.',
      availableWhen: { inventoryAggregate: { 'equipped.names': { eq: 'ansible resonator' } } },
      outcomes: [{ when: true, message: 'x', state: 'info' }],
    })
    const holding = (name: string) => ctxOf([obj('r', { name })], ['r'], ['r'])
    expect(offered(tool, holding('ansible resonator'))).toBe(true)
    expect(offered(tool, holding('ansible resonator mk2'))).toBe(false)
    expect(offered(tool, holding('Ansible Resonator'))).toBe(false)
  })

  it('folds toolVersion 2 and 4', () => {
    const ctx = ctxOf(
      [obj('a', { metadata: { toolVersion: 2 } }), obj('b', { metadata: { toolVersion: 4 } })],
      ['a', 'b'],
      ['a', 'b']
    )
    expect(holds('equipped.metadata.toolVersion.max', { gte: 4 }, ctx)).toBe(true)
    expect(holds('equipped.metadata.toolVersion.min', { gt: 2 }, ctx)).toBe(false)
    expect(holds('equipped.metadata.toolVersion.sum', { eq: 6 }, ctx)).toBe(true)
    expect(holds('equipped.metadata.toolVersion.count', { eq: 2 }, ctx)).toBe(true)
  })

  it('with neither numeric, .max declines both ways and .count is 0', () => {
    const ctx = ctxOf(
      [obj('a', { metadata: { toolVersion: 'two' } }), obj('b', { metadata: {} })],
      ['a', 'b'],
      ['a', 'b']
    )
    expect(holds('equipped.metadata.toolVersion.max', { gte: 0 }, ctx)).toBe(false)
    expect(holds('equipped.metadata.toolVersion.max', { lt: 0 }, ctx)).toBe(false)
    expect(holds('equipped.metadata.toolVersion.count', { eq: 0 }, ctx)).toBe(true)
  })
})

describe('any-of gates', () => {
  const A = { metadata: { a: { eq: true } } }
  const AB = { metadata: { a: { eq: true }, b: { eq: true } } }
  const AC = { metadata: { a: { eq: true }, c: { eq: true } } }
  const available = define({ name: 'x', description: 'x', availableWhen: [AB, AC], outcomes: [{ when: true, message: 'x', state: 'info' }] })
  const withheld = define({ name: 'x', description: 'x', withheldWhen: available.availableWhen, outcomes: [{ when: true, message: 'x', state: 'info' }] })

  it.each([
    [{ a: true, b: true }, true, 0],
    [{ a: true, c: true }, true, 1],
    [{ a: true, b: true, c: true }, true, 0],
    [{ a: true }, false, undefined],
    [{ b: true, c: true }, false, undefined],
  ])('a∧b ∨ a∧c on %j', (sheet, holdsGate, line) => {
    expect(evaluateToolGate(available, sheet)).toEqual(
      holdsGate ? { available: true, heldGroup: line } : { available: false, withheldBy: 'availableWhen' }
    )
    expect(evaluateToolGate(withheld, sheet)).toEqual(
      holdsGate ? { available: false, withheldBy: 'withheldWhen', heldGroup: line } : { available: true }
    )
  })

  it('a null inventory declines every group: availableWhen closed, withheldWhen unsatisfied', () => {
    const groups = [
      { inventoryAggregate: { 'equipped.count': { gte: 0 } } },
      { inventory: { sword: { eq: 'absent' } } },
    ]
    const open = define({ name: 'x', description: 'x', availableWhen: groups, outcomes: [{ when: true, message: 'x', state: 'info' }] })
    const shut = define({ name: 'x', description: 'x', withheldWhen: groups, outcomes: [{ when: true, message: 'x', state: 'info' }] })
    expect(evaluateToolGate(open, {}, undefined, null).available).toBe(false)
    expect(evaluateToolGate(shut, {}, undefined, null).available).toBe(true)
  })

  it('a bare-object gate reports no line', () => {
    const bare = define({ name: 'x', description: 'x', availableWhen: A, outcomes: [{ when: true, message: 'x', state: 'info' }] })
    expect(evaluateToolGate(bare, { a: true })).toEqual({ available: true })
  })
})
