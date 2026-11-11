/**
 * @jest-environment node
 *
 * The item-store kernel (Refactor 4.13, item-family kernel): tier reads that
 * remember what they could not read, one shadowing rule, one name fold.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})

import { foldItemName, readTiers, shadowLayers } from '@/lib/mount-index/item-store'

type Rec = { id: string; from: string }
const mounts: Record<string, Rec[]> = {
  'g-1': [{ id: 'x', from: 'g-1' }],
  'g-2': [{ id: 'x', from: 'g-2' }, { id: 'y', from: 'g-2' }],
  'p-1': [{ id: 'y', from: 'p-1' }],
}
const read = async (mp: string): Promise<Rec[]> => {
  if (mp === 'broken') throw new Error('nope')
  return mounts[mp] ?? []
}

describe('readTiers', () => {
  it('returns one layer per tier, strongest mount first, and consulted in tier order', async () => {
    const result = await readTiers('inventory', [
      { mountPointIds: ['g-1', 'g-2'], read },
      { mountPointIds: ['p-1'], read },
    ])
    expect(result.layers.map((layer) => layer.map((r) => r.from))).toEqual([['g-1', 'g-2', 'g-2'], ['p-1']])
    expect(result.consulted).toEqual(['g-1', 'g-2', 'p-1'])
    expect(result.unread).toEqual([])
  })

  it('records a failed mount as unread and keeps the rest of its tier', async () => {
    const result = await readTiers('atlas', [{ mountPointIds: ['broken', 'g-1'], read }, { mountPointIds: [], read }])
    expect(result.layers).toEqual([[{ id: 'x', from: 'g-1' }], []])
    expect(result.unread).toEqual([{ mountPointId: 'broken', error: 'nope' }])
    expect(result.consulted).toEqual(['broken', 'g-1'])
  })

  it('joins bookkeeping in tier order whatever order the reads settle in (#155)', async () => {
    const slow = async (mp: string) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      if (mp === 'slow-broken') throw new Error('late')
      return []
    }
    const result = await readTiers('wardrobe', [
      { mountPointIds: ['slow-broken'], read: slow },
      { mountPointIds: ['broken'], read },
    ])
    expect(result.unread.map((u) => u.mountPointId)).toEqual(['slow-broken', 'broken'])
  })
})

describe('shadowLayers', () => {
  it('the first record to claim a key keeps it, within a layer and across layers', () => {
    const { byKey, shadowedCount } = shadowLayers(
      [[{ id: 'x', from: 'own' }], [{ id: 'x', from: 'g-1' }, { id: 'y', from: 'g-1' }, { id: 'y', from: 'g-2' }]],
      (r) => r.id,
    )
    expect(Array.from(byKey.values())).toEqual([{ id: 'x', from: 'own' }, { id: 'y', from: 'g-1' }])
    expect(shadowedCount).toBe(2)
  })
})

describe('foldItemName', () => {
  it('trims, lower-cases without a locale, and normalises to NFC', () => {
    expect(foldItemName('  Convertible ')).toBe('convertible')
    expect(foldItemName('CAFÉ')).toBe(foldItemName('café'))
    expect(foldItemName('ISTANBUL')).toBe('istanbul')
  })
})
