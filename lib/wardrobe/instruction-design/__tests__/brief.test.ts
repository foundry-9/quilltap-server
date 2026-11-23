/**
 * @jest-environment node
 *
 * The brief Aurora is handed: each tier's parts, the numbering that makes
 * existing pieces reusable, and that one unreadable part costs only itself.
 */

import {
  BRIEF_MAX_OWN_PIECES,
  buildWardrobeDesignBrief,
  describeWardrobeTarget,
} from '../brief'

jest.mock('@/lib/wardrobe/pool', () => ({
  loadWearablePool: jest.fn(),
}))
jest.mock('@/lib/wardrobe/wardrobe-instructions', () => ({
  resolveWardrobeInstructions: jest.fn(),
  readWardrobeInstructionsFile: jest.fn(),
}))

import { loadWearablePool } from '@/lib/wardrobe/pool'
import { readWardrobeInstructionsFile, resolveWardrobeInstructions } from '@/lib/wardrobe/wardrobe-instructions'

type Item = Record<string, unknown>

const item = (id: string, title: string, extra: Item = {}): Item => ({
  id,
  title,
  types: ['top'],
  imagePrompt: null,
  componentItemIds: [],
  archivedAt: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
})

function location(scope: string, name: string, items: Item[], id: string | null = 'owner-1') {
  return {
    scope,
    mountPointId: 'mount-1',
    origin: { scope, id: scope === 'general' ? null : id, name },
    readItems: jest.fn(async () => items),
  } as never
}

const CHARACTER = {
  id: 'owner-1',
  name: 'Mara Voss',
  pronouns: { subject: 'she', object: 'her', possessive: 'her' },
  physicalDescription: { completePrompt: 'Tall, grey-eyed, a burn scar on the left forearm.' },
  identity: 'Harbour pilot.',
  description: 'Speaks little.',
}

const repos = (character: unknown = CHARACTER) =>
  ({ characters: { findById: jest.fn(async () => character) } }) as never

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(loadWearablePool).mockResolvedValue({
    tiers: { groupMountPointIds: ['group-mount'], projectMountPointIds: [] },
    wearable: () => [
      { ...item('own-1', 'Own Shirt'), characterId: 'owner-1' },
      { ...item('shared-1', 'Guild Sash', { types: ['accessories'] }), characterId: null },
      { ...item('shared-2', 'Guild Livery', { componentItemIds: ['shared-1'] }), characterId: null },
    ],
    owns: (i: { id: string }) => i.id.startsWith('own-'),
  } as never)
  jest.mocked(resolveWardrobeInstructions).mockResolvedValue({ content: 'You favour grey.', tier: 'character', mountPointId: 'mount-1' })
  jest.mocked(readWardrobeInstructionsFile).mockResolvedValue(null)
})

describe('buildWardrobeDesignBrief — a character', () => {
  it('describes the wearer, the dressing instructions, the rail and what is available elsewhere', async () => {
    const brief = await buildWardrobeDesignBrief(
      repos(),
      location('character', 'Mara Voss', [item('a', 'Blazer', { imagePrompt: 'navy wool blazer' }), item('b', 'Old Coat')]),
    )
    expect(brief.text).toContain("Filed in: the character Mara Voss's own wardrobe")
    expect(brief.text).toContain('Pronouns: she/her/her (a woman)')
    expect(brief.text).toContain('Looks: Tall, grey-eyed')
    expect(brief.text).toContain('Harbour pilot.')
    expect(brief.text).toContain('You favour grey.')
    expect(brief.text).toContain('1. Blazer [top] — navy wool blazer')
    expect(brief.text).toContain('- Guild Sash [accessories]')
    expect(brief.text).not.toContain('- Own Shirt')
    expect(brief.text).not.toContain('Guild Livery')
    expect(brief.reusable.map((i) => i.id)).toEqual(['a', 'b'])
    expect(brief.parts).toEqual(expect.arrayContaining(['wearer', 'dressing-instructions', 'rail', 'elsewhere']))
    // The dressing instructions cascade through the character's own groups; no project without a chat.
    expect(jest.mocked(resolveWardrobeInstructions).mock.calls[0][0]).toEqual({
      characterMountPointId: 'mount-1',
      groupMountPointIds: ['group-mount'],
      projectMountPointIds: [],
    })
    expect(jest.mocked(loadWearablePool).mock.calls[0].slice(1, 3)).toEqual(['owner-1', []])
  })

  it('numbers only live leaf pieces, newest first, and lists outfits by title alone', async () => {
    const brief = await buildWardrobeDesignBrief(
      repos(),
      location('character', 'Mara Voss', [
        item('old', 'Old', { updatedAt: '2025-01-01T00:00:00.000Z' }),
        item('new', 'New', { updatedAt: '2026-06-01T00:00:00.000Z' }),
        item('gone', 'Archived', { archivedAt: '2026-02-02T00:00:00.000Z' }),
        item('set', 'Sunday Best', { componentItemIds: ['old', 'new'] }),
      ]),
    )
    expect(brief.reusable.map((i) => i.id)).toEqual(['new', 'old'])
    expect(brief.text).toContain('1. New [top]')
    expect(brief.text).toContain('2. Old [top]')
    expect(brief.text).not.toContain('Archived')
    expect(brief.text).toContain('## Outfit titles already taken here\nSunday Best')
  })

  it('caps the numbered list and says how many more there are', async () => {
    const many = Array.from({ length: BRIEF_MAX_OWN_PIECES + 7 }, (_, i) => item(`i${i}`, `Piece ${i}`))
    const brief = await buildWardrobeDesignBrief(repos(), location('character', 'Mara Voss', many))
    expect(brief.reusable).toHaveLength(BRIEF_MAX_OWN_PIECES)
    expect(brief.text).toContain('…and 7 more, not listed.')
  })

  it('loses only the wearer when the vault cannot be read', async () => {
    const broken = { characters: { findById: jest.fn(async () => { throw new Error('vault unavailable') }) } } as never
    const brief = await buildWardrobeDesignBrief(broken, location('character', 'Mara Voss', [item('a', 'Blazer')]))
    expect(brief.text).not.toContain('## The wearer')
    expect(brief.text).toContain('1. Blazer [top]')
    expect(brief.parts).not.toContain('wearer')
  })

  it('carries on when the rail or the wider wardrobe cannot be read', async () => {
    jest.mocked(loadWearablePool).mockRejectedValue(new Error('group store down'))
    const loc = location('character', 'Mara Voss', [])
    ;(loc as unknown as { readItems: jest.Mock }).readItems.mockRejectedValue(new Error('mount down'))
    const brief = await buildWardrobeDesignBrief(repos(), loc)
    expect(brief.reusable).toEqual([])
    expect(brief.text).toContain('## The wearer')
    expect(brief.text).not.toContain('Already on this rail')
  })

  it('says a non-humanoid wearer is one, and gives no man-or-woman anchor', async () => {
    const sphere = { ...CHARACTER, physicalDescription: { completePrompt: 'Interlocking brass spheres.', humanoid: false } }
    const brief = await buildWardrobeDesignBrief(repos(sphere), location('character', 'Orb', []))
    expect(brief.text).toContain('Not humanoid')
    expect(brief.text).toContain('Pronouns: she/her/her\n')
  })
})

describe('buildWardrobeDesignBrief — shared tiers', () => {
  it('names who may wear the pieces and reads only that tier\'s own instructions', async () => {
    jest.mocked(readWardrobeInstructionsFile).mockResolvedValue('Sober colours only.')
    const brief = await buildWardrobeDesignBrief(repos(), location('project', 'Ashfall', [item('a', 'Greatcoat')]))
    expect(brief.text).toContain('Filed in: the wardrobe of the project "Ashfall"')
    expect(brief.text).toContain("Any character in this project's chats may wear these pieces")
    expect(brief.text).toContain('Sober colours only.')
    expect(brief.text).not.toContain('## The wearer')
    expect(loadWearablePool).not.toHaveBeenCalled()
    expect(resolveWardrobeInstructions).not.toHaveBeenCalled()
    expect(readWardrobeInstructionsFile).toHaveBeenCalledWith('mount-1')
  })

  it('words each tier', () => {
    const origin = (scope: string, name: string) => ({ scope, origin: { scope, id: null, name } }) as never
    expect(describeWardrobeTarget(origin('group', 'The Guild'))).toBe('the wardrobe of the group "The Guild"')
    expect(describeWardrobeTarget(origin('general', 'Quilltap General'))).toBe('Quilltap General (reachable by every character)')
    expect(describeWardrobeTarget(origin('character', ''))).toBe("a character's own wardrobe")
  })
})
