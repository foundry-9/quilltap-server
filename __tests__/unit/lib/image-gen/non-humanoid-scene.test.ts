/**
 * A character whose physical-prompts.json says `humanoid: false` reaches the
 * Lantern's scenes and the image tool without a gender anchor and with the
 * non-humanoid direction, whatever its pronouns.
 */

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() },
}))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/wardrobe/pool', () => ({ loadWearablePool: jest.fn() }))

import { sceneDescriptionParts } from '@/lib/image-gen/appearance-resolution'
import { buildExpansionContext } from '@/lib/image-gen/prompt-expansion'
import { NON_HUMANOID_IMAGE_DIRECTION } from '@/lib/characters/physical-description'

const HE = { subject: 'he', object: 'him', possessive: 'his' }

describe('non-humanoid characters in scene prompts', () => {
  it('the Lantern drops the gender prefix and adds the direction', () => {
    const parts = sceneDescriptionParts(
      { physicalDescription: 'seven interlocking brass spheres', clothingDescription: '', humanoid: false },
      'A man. ',
    )
    expect(parts).toEqual(['seven interlocking brass spheres', NON_HUMANOID_IMAGE_DIRECTION])
  })

  it('a humanoid (or unflagged) character is unchanged', () => {
    expect(sceneDescriptionParts({ physicalDescription: 'a tall man', clothingDescription: '' }, 'A man. '))
      .toEqual(['A man. a tall man'])
  })

  it('the image tool flags it and gives no gender, from raw descriptions or a resolved appearance', () => {
    const raw = buildExpansionContext('Paint {{Orrery}}', [{
      placeholder: '{{Orrery}}', name: 'Orrery', type: 'character', entityId: 'c-o', pronouns: HE,
      descriptions: [{ id: 'pd', name: 'default', humanoid: false, mediumPrompt: 'spheres' }],
    } as never], 'OPENAI')
    expect(raw.placeholders[0]).toEqual(expect.objectContaining({ nonHumanoid: true, gender: undefined }))

    const resolved = buildExpansionContext('Paint {{Orrery}}', [{
      placeholder: '{{Orrery}}', name: 'Orrery', type: 'character', entityId: 'c-o', pronouns: HE, descriptions: [],
    } as never], 'OPENAI', [{
      characterId: 'c-o', characterName: 'Orrery', physicalDescription: 'spheres', physicalDescriptionName: 'default',
      clothingDescription: '', clothingSource: 'default', wasSanitized: false, humanoid: false,
    }])
    expect(resolved.placeholders[0]).toEqual(expect.objectContaining({ nonHumanoid: true, gender: undefined }))

    const human = buildExpansionContext('Paint {{Viv}}', [{
      placeholder: '{{Viv}}', name: 'Viv', type: 'character', entityId: 'c-v', pronouns: HE, descriptions: [],
    } as never], 'OPENAI')
    expect(human.placeholders[0].nonHumanoid).toBeUndefined()
    expect(human.placeholders[0].gender).toBe('male')
  })
})
