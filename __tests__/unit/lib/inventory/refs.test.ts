/**
 * The one reference rule (inventory-tools-and-pascal §5.1): id → title →
 * name, case-insensitive, own tier first; the best state among matches; kin
 * counts; and which match a gesture acts on.
 */

import {
  equippedKinCount,
  inventoryContextFrom,
  pickForGesture,
  resolveInventoryRef,
  stateOf,
  type ResolvedInventoryPool,
} from '@/lib/inventory/refs'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'

const T = '2026-10-18T00:00:00.000Z'
function obj(id: string, fields: Partial<ResolvedInventoryItem> = {}): ResolvedInventoryItem {
  return {
    id, kind: 'item', name: 'sword', title: null, equippedByDefault: false, maxEquipped: 1, canCopy: false,
    isArchetype: false, parentId: null, itemIds: [], metadata: {}, folder: '', archivedAt: null, createdAt: T, updatedAt: T,
    ...fields,
  } as ResolvedInventoryItem
}

function pool(items: ResolvedInventoryItem[], own: string[]): ResolvedInventoryPool {
  const owned = new Set(own)
  return { items, owns: (id) => owned.has(id) }
}

describe('resolveInventoryRef', () => {
  const excalibur = obj('aaaa', { title: 'Excalibur' })
  const shared = obj('bbbb', { title: null })
  const p = pool([shared, excalibur], ['aaaa'])

  it('takes an id first, case-insensitively', () => {
    expect(resolveInventoryRef('AAAA', p, new Set()).map((m) => m.item.id)).toEqual(['aaaa'])
  })

  it('then a title, then a name, own tier first', () => {
    expect(resolveInventoryRef('excalibur', p, new Set()).map((m) => m.item.id)).toEqual(['aaaa'])
    expect(resolveInventoryRef('Sword', p, new Set()).map((m) => m.item.id)).toEqual(['aaaa', 'bbbb'])
  })

  it('a title match wins over a name match', () => {
    const named = obj('cccc', { name: 'Excalibur' })
    expect(resolveInventoryRef('excalibur', pool([named, excalibur], []), new Set()).map((m) => m.item.id)).toEqual(['aaaa'])
  })

  it('excludes archetypes and archived objects unless asked', () => {
    const bow = obj('bow', { name: 'magic bow', isArchetype: true })
    const old = obj('old', { name: 'lantern', archivedAt: T })
    const q = pool([bow, old], ['old'])
    expect(resolveInventoryRef('magic bow', q, new Set())).toEqual([])
    expect(resolveInventoryRef('magic bow', q, new Set(), { includeArchetypes: true })).toHaveLength(1)
    expect(resolveInventoryRef('lantern', q, new Set())).toEqual([])
    expect(resolveInventoryRef('lantern', q, new Set(), { includeArchived: true })).toHaveLength(1)
  })

  it('an empty reference resolves to nothing', () => {
    expect(resolveInventoryRef('  ', p, new Set())).toEqual([])
  })
})

describe('stateOf', () => {
  const own = obj('own')
  const shared = obj('shared')
  const p = pool([own, shared], ['own'])

  it('equipped > carried > reachable > absent', () => {
    expect(stateOf(resolveInventoryRef('sword', p, new Set(['shared'])))).toBe('equipped')
    expect(stateOf(resolveInventoryRef('sword', p, new Set()))).toBe('carried')
    expect(stateOf(resolveInventoryRef('sword', pool([shared], []), new Set()))).toBe('reachable')
    expect(stateOf(resolveInventoryRef('axe', p, new Set()))).toBe('absent')
  })

  it('a shared lantern is reachable, not carried, by the whole cast', () => {
    const lantern = obj('lantern', { name: 'lantern', origin: { scope: 'project', id: 'p', name: 'Project' } })
    expect(stateOf(resolveInventoryRef('lantern', pool([lantern], []), new Set()))).toBe('reachable')
  })
})

describe('equippedKinCount', () => {
  it('counts equipped objects sharing the first match\'s name', () => {
    const items = [obj('r1', { name: 'ring' }), obj('r2', { name: 'Ring' }), obj('r3', { name: 'ring' })]
    const p = pool(items, ['r1', 'r2', 'r3'])
    expect(equippedKinCount('ring', p, new Set(['r1', 'r2']))).toBe(2)
    expect(equippedKinCount('r3', p, new Set(['r1']))).toBe(1)
    expect(equippedKinCount('axe', p, new Set(['r1']))).toBe(0)
  })

  it('an archetype reference counts its instances by name', () => {
    const bow = obj('bow', { name: 'bow', isArchetype: true })
    const mine = obj('mine', { name: 'bow', parentId: 'bow' })
    expect(equippedKinCount('bow', pool([bow, mine], ['mine']), new Set(['mine']))).toBe(1)
  })
})

describe('pickForGesture', () => {
  const a = obj('a')
  const b = obj('b')
  const p = pool([a, b], ['a'])

  it('equip takes the first unequipped one, own first', () => {
    expect(pickForGesture(resolveInventoryRef('sword', p, new Set()), 'equip')?.item.id).toBe('a')
    expect(pickForGesture(resolveInventoryRef('sword', p, new Set(['a'])), 'equip')?.item.id).toBe('b')
    expect(pickForGesture(resolveInventoryRef('sword', p, new Set(['a', 'b'])), 'equip')).toBeNull()
  })

  it('unequip takes the first equipped one', () => {
    expect(pickForGesture(resolveInventoryRef('sword', p, new Set(['b'])), 'unequip')?.item.id).toBe('b')
    expect(pickForGesture(resolveInventoryRef('sword', p, new Set()), 'unequip')).toBeNull()
  })

  it('unequip falls back to a kit, which sets down whatever members it holds', () => {
    const kit = obj('kit', { kind: 'kit', name: 'loadout', itemIds: ['a', 'b'] })
    const withKit = pool([a, b, kit], ['a', 'kit'])
    // Only one member carried: the kit is not "equipped", yet unequip acts on it.
    expect(pickForGesture(resolveInventoryRef('loadout', withKit, new Set(['a'])), 'unequip')?.item.id).toBe('kit')
  })
})

describe('inventoryContextFrom', () => {
  it('reads an equipped object first for a placeholder', () => {
    const a = obj('a', { title: 'Mine' })
    const b = obj('b', { title: 'Theirs' })
    const ctx = inventoryContextFrom('c', 'chat', pool([a, b], ['a']), new Set(['b']))
    expect(ctx.state('sword')).toBe('equipped')
    expect(ctx.item('sword')?.title).toBe('Theirs')
    expect(ctx.equippedKinCount('sword')).toBe(1)
  })
})
