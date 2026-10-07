/**
 * Wardrobe item picture prompt (lib/wardrobe/item-image-prompt.ts).
 *
 * Worn vs catalogue selection, the canonical slot order of an outfit's cue,
 * hair-only framing, and — the anti-drift guarantee — that the figure in a
 * worn picture is described by the very identity block the avatar portrait
 * opens with (`buildFigureIdentityBlock`).
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { Character } from '@/lib/schemas/character.types'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const mockResolveAesthetic = jest.fn<(...args: unknown[]) => Promise<string | null>>()
jest.mock('@/lib/image-gen/aesthetic', () => ({
  resolveAesthetic: (...args: unknown[]) => mockResolveAesthetic(...args),
}))

jest.mock('@/lib/wardrobe/resolve-equipped', () => ({
  resolveEquippedOutfitForCharacter: jest.fn(),
}))

const { buildWardrobeItemImagePrompt, buildWardrobeItemCue } =
  require('@/lib/wardrobe/item-image-prompt') as typeof import('@/lib/wardrobe/item-image-prompt')
const { buildFigureIdentityBlock, buildCharacterAvatarPrompt } =
  require('@/lib/wardrobe/avatar-prompt') as typeof import('@/lib/wardrobe/avatar-prompt')

const NOW = '2026-01-01T00:00:00.000Z'

let idCounter = 0
function item(overrides: Partial<WardrobeItem> = {}): WardrobeItem {
  idCounter++
  return {
    id: `00000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`,
    characterId: null,
    title: `Item ${idCounter}`,
    description: 'Prose that must never reach a diffusion model.',
    imagePrompt: null,
    types: ['top'],
    componentItemIds: [],
    appropriateness: null,
    isDefault: false,
    replace: false,
    migratedFromClothingRecordId: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as WardrobeItem
}

const owner = {
  name: 'Lady Agatha',
  pronouns: { subject: 'she', object: 'her', possessive: 'her' },
  physicalDescription: {
    id: 'pd-1',
    headAndShouldersPrompt: 'Sharp-featured woman with silver bobbed hair',
    completePrompt: 'Tall, angular woman in her sixties with silver bobbed hair and a cane.',
  },
  archivedAt: null,
} as unknown as Pick<Character, 'name' | 'physicalDescription' | 'pronouns' | 'archivedAt'>

describe('buildWardrobeItemImagePrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveAesthetic.mockResolvedValue(null)
  })

  it('draws an owned item worn by its owner, portrait orientation', async () => {
    const garment = item({ title: 'Opera coat', imagePrompt: 'emerald velvet opera coat with fur collar' })
    const result = await buildWardrobeItemImagePrompt({ item: garment, components: [], owner })

    expect(result.subject).toBe('worn')
    expect(result.orientation).toBe('portrait')
    expect(result.prompt).toContain('Lady Agatha')
    expect(result.prompt).toContain('single woman')
    expect(result.prompt).toContain('Full-length')
    expect(result.prompt).toContain('emerald velvet opera coat with fur collar')
    // imagePrompt wins over the title; the Markdown description never rides.
    expect(result.prompt).not.toContain('Opera coat')
    expect(result.prompt).not.toContain('Prose that must never')
  })

  it('draws a catalogue shot, square, when there is no owner', async () => {
    const garment = item({ title: 'Bowler hat', types: ['accessories'] })
    const result = await buildWardrobeItemImagePrompt({ item: garment, components: [], owner: null })

    expect(result.subject).toBe('catalogue')
    expect(result.orientation).toBe('square')
    expect(result.prompt).toContain('Bowler hat')
    expect(result.prompt).toContain('no person')
    expect(result.prompt).not.toContain('Lady Agatha')
  })

  it('treats an archived owner as no owner — a catalogue shot', async () => {
    const garment = item({ title: 'Waistcoat' })
    const result = await buildWardrobeItemImagePrompt({
      item: garment,
      components: [],
      owner: { ...owner, archivedAt: NOW } as typeof owner,
    })

    expect(result.subject).toBe('catalogue')
    expect(result.orientation).toBe('square')
    expect(result.prompt).not.toContain('Lady Agatha')
  })

  it('frames a hair-only item head and shoulders, using the head-and-shoulders description', async () => {
    const hair = item({ title: 'Finger waves', types: ['hair'] })
    const result = await buildWardrobeItemImagePrompt({ item: hair, components: [], owner })

    expect(result.subject).toBe('worn')
    expect(result.prompt).toContain('Head-and-shoulders')
    expect(result.prompt).not.toContain('Full-length')
    expect(result.prompt).toContain('Sharp-featured woman with silver bobbed hair.')
    expect(result.prompt).not.toContain('cane')
  })

  it('opens a worn picture with exactly the identity block the avatar uses', async () => {
    const garment = item({ title: 'Tweed suit', types: ['top', 'bottom'] })
    const result = await buildWardrobeItemImagePrompt({ item: garment, components: [], owner })

    const figure = buildFigureIdentityBlock(owner, 'full-length')
    expect(figure.subjectNoun).toBe('woman')
    expect(figure.physBlock).toBe('Tall, angular woman in her sixties with silver bobbed hair and a cane.')
    expect(result.prompt).toContain(`single ${figure.subjectNoun}: Lady Agatha`)
    expect(result.prompt).toContain(figure.physBlock)
  })

  it('prepends the aesthetic as art direction when one resolves', async () => {
    mockResolveAesthetic.mockResolvedValue('  Sepia-toned 1920s fashion plate  ')
    const garment = item({ title: 'Cloche hat', types: ['accessories'] })
    const result = await buildWardrobeItemImagePrompt({
      item: garment,
      components: [],
      owner: null,
      projectOfficialMountPointId: 'mount-proj',
    })

    expect(mockResolveAesthetic).toHaveBeenCalledWith({ kind: 'aurora', projectOfficialMountPointId: 'mount-proj' })
    expect(result.prompt.startsWith('Art direction (apply this overall style): Sepia-toned 1920s fashion plate\n\n')).toBe(true)
  })
})

describe('buildWardrobeItemCue', () => {
  it('lists an outfit\'s leaves in canonical slot order, imagePrompt over title, empty slots omitted', () => {
    const outfit = item({ title: 'Evening ensemble', types: ['top', 'bottom', 'footwear', 'accessories', 'hair'] })
    const components = [
      item({ title: 'Marcel waves', types: ['hair'] }),
      item({ title: 'Pearls', imagePrompt: 'long rope of pearls', types: ['accessories'] }),
      item({ title: 'T-strap shoes', types: ['footwear'] }),
      item({ title: 'Beaded shift', imagePrompt: 'silver beaded drop-waist shift', types: ['top'] }),
    ]

    const cue = buildWardrobeItemCue(outfit, components)
    const order = ['silver beaded drop-waist shift', 'T-strap shoes', 'long rope of pearls', 'Marcel waves']
    const positions = order.map((text) => cue.indexOf(text))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(cue).not.toContain('Beaded shift')
    expect(cue).not.toContain('Pearls')
    // No bottom component and none described as missing: no "barefoot"/"naked" fallbacks.
    expect(cue).not.toMatch(/bottom/i)
    expect(cue).not.toMatch(/naked|barefoot|topless/i)
  })

  it('uses the single garment\'s cue when there are no components', () => {
    expect(buildWardrobeItemCue(item({ title: 'Spats' }), [])).toBe('Spats')
    expect(buildWardrobeItemCue(item({ title: 'Spats', imagePrompt: 'white canvas spats' }), [])).toBe('white canvas spats')
  })

  it('renders an owned outfit as a list inside the worn prompt', async () => {
    mockResolveAesthetic.mockResolvedValue(null)
    const outfit = item({ title: 'Day dress', types: ['top', 'bottom'] })
    const components = [
      item({ title: 'Pleated skirt', types: ['bottom'] }),
      item({ title: 'Silk blouse', types: ['top'] }),
    ]
    const result = await buildWardrobeItemImagePrompt({ item: outfit, components, owner })
    expect(result.prompt).toContain('the following ensemble:\n\n')
    expect(result.prompt.indexOf('Silk blouse')).toBeLessThan(result.prompt.indexOf('Pleated skirt'))
  })
})

describe('buildCharacterAvatarPrompt (refactored onto buildFigureIdentityBlock)', () => {
  it('still opens with the head-and-shoulders physical text and the pronoun noun', async () => {
    const character = {
      id: 'char-1',
      ...owner,
    } as unknown as Character
    const { prompt, hasAppearance } = await buildCharacterAvatarPrompt({} as never, character, {})

    expect(hasAppearance).toBe(true)
    expect(prompt).toContain('Solo portrait of a single woman: Lady Agatha.')
    expect(prompt).toContain('head-and-shoulders crop, three-quarter view. Sharp-featured woman with silver bobbed hair.')
    expect(prompt).not.toContain('cane')
    expect(prompt).toMatch(/Character portrait, detailed, high quality, natural lighting\. Only one person in the image\.$/)
  })
})
