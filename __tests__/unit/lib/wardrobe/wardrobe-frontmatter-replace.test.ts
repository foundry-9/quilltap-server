import { describe, expect, it, jest } from '@jest/globals'

jest.mock('@/lib/logger', () => {
  const base = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() }
  return { logger: { ...base, child: jest.fn(() => base) } }
})

const { buildWardrobeItemFile } =
  require('@/lib/mount-index/character-vault') as typeof import('@/lib/mount-index/character-vault')
const { parseWardrobeItemFile } =
  require('@/lib/database/repositories/vault-overlay/parsers') as typeof import('@/lib/database/repositories/vault-overlay/parsers')

import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

const NOW = '2026-01-01T00:00:00.000Z'

function makeItem(overrides: Partial<WardrobeItem> = {}): WardrobeItem {
  return {
    id: '65becae7-4b63-495e-9dcf-81010fb28437',
    characterId: 'c1',
    title: 'Naked',
    description: 'Wearing nothing except her wedding ring.',
    types: ['top', 'bottom', 'footwear', 'accessories'],
    componentItemIds: ['white-gold-wedding-ring'],
    appropriateness: 'intimate',
    isDefault: false,
    replace: true,
    migratedFromClothingRecordId: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function docFor(content: string) {
  return {
    content,
    fileName: 'Naked.md',
    relativePath: 'Wardrobe/Naked.md',
    mountPointId: 'm1',
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as Parameters<typeof parseWardrobeItemFile>[0]
}

describe('wardrobe frontmatter — replace flag round-trip', () => {
  it('emits `replace: true` in frontmatter and parses it back', () => {
    const md = buildWardrobeItemFile(makeItem({ replace: true }), new Map())
    expect(md).toMatch(/replace:\s*true/)

    const parsed = parseWardrobeItemFile(docFor(md), 'c1')
    expect(parsed).not.toBeNull()
    expect(parsed!.replace).toBe(true)
    // Superset coverage survives the round-trip (Naked designates all slots).
    expect(parsed!.types).toEqual(['top', 'bottom', 'footwear', 'accessories'])
    expect(parsed!.componentItemIds).toEqual(['white-gold-wedding-ring'])
  })

  it('omits `replace` from frontmatter when false and parses to false', () => {
    const md = buildWardrobeItemFile(makeItem({ replace: false }), new Map())
    expect(md).not.toMatch(/replace:/)

    const parsed = parseWardrobeItemFile(docFor(md), 'c1')
    expect(parsed).not.toBeNull()
    expect(parsed!.replace).toBe(false)
  })
})
