/**
 * Wardrobe pronoun guidance: the offering rule, the normaliser, and the
 * frontmatter round-trip.
 */

jest.mock('@/lib/logger', () => {
  const base = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() }
  return { logger: { ...base, child: jest.fn(() => base) } }
})

const {
  filterByPronounGuidance,
  fitsPronounGuidance,
  formatPronounGuidance,
  normalizePronounGuidance,
} = require('@/lib/wardrobe/pronoun-guidance') as typeof import('@/lib/wardrobe/pronoun-guidance')
const { standardPronounSubjectOf, STANDARD_PRONOUN_SUBJECTS } =
  require('@/lib/characters/pronoun-presets') as typeof import('@/lib/characters/pronoun-presets')
const { buildWardrobeItemFile } =
  require('@/lib/mount-index/character-vault') as typeof import('@/lib/mount-index/character-vault')
const { parseWardrobeItemFile } =
  require('@/lib/database/repositories/vault-overlay/parsers') as typeof import('@/lib/database/repositories/vault-overlay/parsers')
const { wardrobeItemFieldsSchema } =
  require('@/lib/schemas/wardrobe.types') as typeof import('@/lib/schemas/wardrobe.types')

import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

const HE = { subject: 'he', object: 'him', possessive: 'his' }
const SHE = { subject: 'she', object: 'her', possessive: 'her' }
const XE = { subject: 'xe', object: 'xem', possessive: 'xyr' }
const NOW = '2026-01-01T00:00:00.000Z'

describe('pronoun presets', () => {
  it('lists the four Aurora presets by subject', () => {
    expect(STANDARD_PRONOUN_SUBJECTS).toEqual(['he', 'she', 'they', 'it'])
  })

  it('recognises a whole standard set and nothing else', () => {
    expect(standardPronounSubjectOf(HE)).toBe('he')
    expect(standardPronounSubjectOf({ subject: 'She', object: 'Her', possessive: 'Her' })).toBe('she')
    expect(standardPronounSubjectOf({ subject: 'they', object: 'them', possessive: 'his' })).toBeNull()
    expect(standardPronounSubjectOf(XE)).toBeNull()
    expect(standardPronounSubjectOf(null)).toBeNull()
  })
})

describe('normalizePronounGuidance', () => {
  it('keeps known subjects in picker order, de-duplicated', () => {
    expect(normalizePronounGuidance(['They', 'he', 'he', 'xe', 7])).toEqual(['he', 'they'])
  })

  it('reads a single string and a preset label', () => {
    expect(normalizePronounGuidance('she')).toEqual(['she'])
    expect(normalizePronounGuidance(['He/Him/His'])).toEqual(['he'])
  })

  it('reads anything else as no guidance', () => {
    expect(normalizePronounGuidance(undefined)).toEqual([])
    expect(normalizePronounGuidance({ he: true })).toEqual([])
  })
})

describe('fitsPronounGuidance', () => {
  const gown = { pronounGuidance: ['she', 'they'] }

  it('offers an item without guidance to everyone', () => {
    expect(fitsPronounGuidance({}, HE)).toBe(true)
    expect(fitsPronounGuidance({ pronounGuidance: [] }, HE)).toBe(true)
  })

  it('offers a guided item only to the pronouns it names', () => {
    expect(fitsPronounGuidance(gown, SHE)).toBe(true)
    expect(fitsPronounGuidance(gown, HE)).toBe(false)
  })

  it('offers everything to a character with custom or unset pronouns', () => {
    expect(fitsPronounGuidance(gown, XE)).toBe(true)
    expect(fitsPronounGuidance(gown, null)).toBe(true)
  })
})

describe('filterByPronounGuidance', () => {
  const items = [
    { id: 'gown', pronounGuidance: ['she'] },
    { id: 'suit', pronounGuidance: ['he'] },
    { id: 'boots' },
  ]

  it('drops what does not fit and counts it', () => {
    const { items: kept, hiddenCount } = filterByPronounGuidance(items, HE)
    expect(kept.map((i) => i.id)).toEqual(['suit', 'boots'])
    expect(hiddenCount).toBe(1)
  })

  it('always keeps the ids it is told to', () => {
    const { items: kept, hiddenCount } = filterByPronounGuidance(items, HE, new Set(['gown']))
    expect(kept.map((i) => i.id)).toEqual(['gown', 'suit', 'boots'])
    expect(hiddenCount).toBe(0)
  })
})

describe('formatPronounGuidance', () => {
  it('names the presets', () => {
    expect(formatPronounGuidance(['they', 'he'])).toBe('He/Him/His, They/Them/Their')
    expect(formatPronounGuidance(undefined)).toBe('')
  })
})

describe('wardrobe item schema', () => {
  it('accepts known guidance and refuses unknown values', () => {
    const base = { title: 'Gown', types: ['top'] }
    expect(wardrobeItemFieldsSchema.safeParse({ ...base, pronounGuidance: ['she', 'they'] }).success).toBe(true)
    expect(wardrobeItemFieldsSchema.safeParse({ ...base, pronounGuidance: ['xe'] }).success).toBe(false)
  })
})

describe('wardrobe frontmatter — pronounGuidance round-trip', () => {
  const makeItem = (overrides: Partial<WardrobeItem> = {}): WardrobeItem => ({
    id: '65becae7-4b63-495e-9dcf-81010fb28437',
    characterId: 'c1',
    title: 'Ball Gown',
    description: null,
    types: ['top', 'bottom'],
    componentItemIds: [],
    appropriateness: null,
    isDefault: false,
    replace: false,
    migratedFromClothingRecordId: null,
    archivedAt: null,
    folder: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  })
  const docFor = (content: string) =>
    ({
      content,
      fileName: 'Ball Gown.md',
      relativePath: 'Wardrobe/Ball Gown.md',
      mountPointId: 'm1',
      createdAt: NOW,
      updatedAt: NOW,
    }) as unknown as Parameters<typeof parseWardrobeItemFile>[0]

  it('writes the list and reads it back', () => {
    const md = buildWardrobeItemFile(makeItem({ pronounGuidance: ['they', 'she'] }), new Map())
    expect(md).toMatch(/pronounGuidance:/)
    expect(parseWardrobeItemFile(docFor(md), 'c1')!.pronounGuidance).toEqual(['she', 'they'])
  })

  it('omits the key when there is no guidance and reads back as absent', () => {
    const md = buildWardrobeItemFile(makeItem({ pronounGuidance: [] }), new Map())
    expect(md).not.toMatch(/pronounGuidance/)
    expect(parseWardrobeItemFile(docFor(md), 'c1')!.pronounGuidance).toBeUndefined()
  })

  it('drops hand-edited values it does not recognise', () => {
    const md = '---\ntitle: Ball Gown\ntypes: [top]\npronounGuidance: [She, xe]\n---\n'
    expect(parseWardrobeItemFile(docFor(md), 'c1')!.pronounGuidance).toEqual(['she'])
  })
})
