import { describe, expect, it, jest } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}))

const { expandComposites, detectComponentCycles } = require('@/lib/wardrobe/expand-composites')
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'

const NOW = '2026-01-01T00:00:00.000Z'

function makeItem(
  id: string,
  types: WardrobeItemType[],
  componentItemIds: string[] = [],
): WardrobeItem {
  return {
    id,
    characterId: 'c1c1c1c1-0000-0000-0000-000000000001',
    title: id,
    types,
    componentItemIds,
    isDefault: false,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function buildMap(items: WardrobeItem[]): Map<string, WardrobeItem> {
  return new Map(items.map((i) => [i.id, i]))
}

describe('expandComposites', () => {
  it('returns empty leafIds for empty input', () => {
    const result = expandComposites([], buildMap([]))
    expect(result.leafIds).toEqual([])
    expect(result.cycles).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('returns a leaf item unchanged', () => {
    const shirt = makeItem('shirt', ['top'])
    const result = expandComposites(['shirt'], buildMap([shirt]))
    expect(result.leafIds).toEqual(['shirt'])
    expect(result.cycles).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('surfaces unknown ids as leaves', () => {
    const result = expandComposites(['unknown-id'], buildMap([]))
    expect(result.leafIds).toEqual(['unknown-id'])
  })

  it('expands a composite to its components', () => {
    const shirt = makeItem('shirt', ['top'])
    const jeans = makeItem('jeans', ['bottom'])
    const outfit = makeItem('outfit', ['top', 'bottom'], ['shirt', 'jeans'])
    const result = expandComposites(['outfit'], buildMap([shirt, jeans, outfit]))
    expect(result.leafIds).toContain('shirt')
    expect(result.leafIds).toContain('jeans')
    expect(result.leafIds).not.toContain('outfit')
    expect(result.cycles).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('expands transitively (composite within composite)', () => {
    const ring = makeItem('ring', ['accessories'])
    const earrings = makeItem('earrings', ['accessories'])
    const jewelry = makeItem('jewelry', ['accessories'], ['ring', 'earrings'])
    const fullOutfit = makeItem('full-outfit', ['top', 'accessories'], ['jewelry'])
    const result = expandComposites(['full-outfit'], buildMap([ring, earrings, jewelry, fullOutfit]))
    expect(result.leafIds).toContain('ring')
    expect(result.leafIds).toContain('earrings')
    expect(result.leafIds).not.toContain('jewelry')
    expect(result.leafIds).not.toContain('full-outfit')
  })

  it('deduplicates leaves that appear in multiple composites', () => {
    const scarf = makeItem('scarf', ['accessories'])
    const outfit1 = makeItem('outfit1', ['accessories'], ['scarf'])
    const outfit2 = makeItem('outfit2', ['accessories'], ['scarf'])
    const result = expandComposites(['outfit1', 'outfit2'], buildMap([scarf, outfit1, outfit2]))
    const scarfCount = result.leafIds.filter((id) => id === 'scarf').length
    expect(scarfCount).toBe(1)
  })

  it('detects and reports a direct self-cycle', () => {
    const cyclicItem = makeItem('self', ['top'], ['self'])
    const result = expandComposites(['self'], buildMap([cyclicItem]))
    expect(result.cycles.length).toBeGreaterThan(0)
    expect(result.cycles[0]).toContain('self')
  })

  it('detects an indirect cycle and does not loop forever', () => {
    const a = makeItem('a', ['top'], ['b'])
    const b = makeItem('b', ['top'], ['a'])
    const result = expandComposites(['a'], buildMap([a, b]))
    expect(result.cycles.length).toBeGreaterThan(0)
  })

  it('truncates at maxDepth and sets truncated=true', () => {
    // Build a chain: d0 -> d1 -> d2 -> d3 -> d4 -> d5 (deeper than default maxDepth=4)
    const items: WardrobeItem[] = []
    for (let i = 5; i >= 1; i--) {
      items.push(makeItem(`d${i}`, ['top'], [`d${i + 1}`]))
    }
    // d6 is the leaf
    items.push(makeItem('d6', ['top']))
    // Root
    items.push(makeItem('d0', ['top'], ['d1']))

    const result = expandComposites(['d0'], buildMap(items))
    expect(result.truncated).toBe(true)
  })

  it('respects custom maxDepth option', () => {
    // 3 levels deep — should NOT truncate at maxDepth=4, but SHOULD at maxDepth=2
    const leaf = makeItem('leaf', ['top'])
    const level2 = makeItem('level2', ['top'], ['leaf'])
    const level1 = makeItem('level1', ['top'], ['level2'])
    const root = makeItem('root', ['top'], ['level1'])

    const okResult = expandComposites(['root'], buildMap([leaf, level2, level1, root]), { maxDepth: 4 })
    expect(okResult.truncated).toBe(false)
    expect(okResult.leafIds).toContain('leaf')

    const truncResult = expandComposites(['root'], buildMap([leaf, level2, level1, root]), { maxDepth: 2 })
    expect(truncResult.truncated).toBe(true)
  })

  it('expands multiple independent roots', () => {
    const shirt = makeItem('shirt', ['top'])
    const jeans = makeItem('jeans', ['bottom'])
    const result = expandComposites(['shirt', 'jeans'], buildMap([shirt, jeans]))
    expect(result.leafIds).toEqual(['shirt', 'jeans'])
  })
})

describe('detectComponentCycles', () => {
  it('returns empty array when no cycle exists', () => {
    const leaf = makeItem('leaf', ['top'])
    const result = detectComponentCycles('parent', ['leaf'], buildMap([leaf]))
    expect(result).toEqual([])
  })

  it('detects a direct self-reference', () => {
    const result = detectComponentCycles('self', ['self'], buildMap([]))
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]).toContain('self')
  })

  it('detects an indirect cycle through grandchild', () => {
    // parent -> child -> grandchild=parent
    const child = makeItem('child', ['top'], ['grandchild'])
    const grandchild = makeItem('grandchild', ['top'], ['parent'])
    const result = detectComponentCycles('parent', ['child'], buildMap([child, grandchild]))
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns empty when componentItemIds is empty', () => {
    const result = detectComponentCycles('parent', [], buildMap([]))
    expect(result).toEqual([])
  })
})
