/**
 * The Inventory reaches the pictures through the appearance resolver and the
 * avatar prompt (spec §5.7): the Lantern's character description, the image
 * tool's expansion context and the avatar portrait each carry the phrase, and
 * nothing when there is none.
 */

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() },
}))
const mockLoadCarryingPhrase = jest.fn()
jest.mock('@/lib/inventory/image-description', () => ({
  loadCarryingPhrase: (...args: unknown[]) => mockLoadCarryingPhrase(...args),
}))
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({ chats: { findById: jest.fn(async (id: string) => ({ id, equippedInventory: {} })) } }),
}))
jest.mock('@/lib/wardrobe/pool', () => ({ loadWearablePool: jest.fn() }))

import { resolveCharacterAppearances, sceneDescriptionParts } from '@/lib/image-gen/appearance-resolution'
import { buildExpansionContext } from '@/lib/image-gen/prompt-expansion'
import { buildCharacterAvatarPrompt } from '@/lib/image-gen/avatar-prompt'

const PHRASE = 'carrying a longsword with a jewelled pommel'
const SCENE_STATE = { characters: [{ characterId: 'c-viv', characterName: 'Vivienne', appearance: 'a tall woman', clothing: 'a green cloak' }] }
const INPUT = [{ characterId: 'c-viv', characterName: 'Vivienne', physicalDescription: null }]

async function resolveWith(phrase: string | null) {
  mockLoadCarryingPhrase.mockResolvedValue(phrase)
  const { appearances } = await resolveCharacterAppearances(INPUT, [], 'a scene', {} as never, 'user-1', 'chat-1', SCENE_STATE)
  return appearances[0]
}

describe('carried objects in the pictures', () => {
  it('the resolver adds the phrase beside the outfit, and the Lantern renders it', async () => {
    const resolved = await resolveWith(PHRASE)
    expect(resolved.carryingDescription).toBe(PHRASE)
    expect(sceneDescriptionParts(resolved, 'Woman: ').join('. ')).toBe(
      'Woman: a tall woman. Wearing: a green cloak. Carrying a longsword with a jewelled pommel',
    )
    const none = await resolveWith(null)
    expect(none.carryingDescription).toBeUndefined()
    expect(sceneDescriptionParts(none).join('. ')).toBe('a tall woman. Wearing: a green cloak')
  })

  it('the image tool sees it as a carried entry beside the outfit', async () => {
    const resolved = await resolveWith(PHRASE)
    const context = buildExpansionContext('Paint {{Vivienne}}', [{ placeholder: '{{Vivienne}}', name: 'Vivienne', entityId: 'c-viv', descriptions: [] } as never], 'OPENAI', [resolved])
    expect(context.placeholders[0].clothing).toEqual([
      expect.objectContaining({ name: 'Current outfit (from story)', description: 'a green cloak' }),
      expect.objectContaining({ name: 'Carried', description: PHRASE }),
    ])
  })

  it('the avatar portrait carries it, and nothing when there is none', async () => {
    const character = { id: 'c-viv', name: 'Vivienne', physicalDescription: { id: 'pd', mediumPrompt: 'A tall woman.' } } as never
    const withIt = await buildCharacterAvatarPrompt({} as never, character, { carrying: PHRASE })
    expect(withIt.prompt).toContain('Carrying a longsword with a jewelled pommel.')
    const without = await buildCharacterAvatarPrompt({} as never, character, { carrying: null })
    expect(without.prompt).not.toMatch(/carrying/i)
  })
})
