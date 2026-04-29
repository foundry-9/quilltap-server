/**
 * Tests for Summon From Lore (ai-import.service) field-semantics changes.
 *
 * Locks in:
 * - the CHARACTER_BASICS_PROMPT now asks the LLM for an `identity` field with
 *   the proper vantage-point framing
 * - description is no longer asked to include physical appearance
 * - assembleQtapExport carries `identity` onto the assembled character
 */

import {
  CHARACTER_BASICS_PROMPT,
  assembleQtapExport,
  type AIImportStepResults,
} from '@/lib/services/ai-import.service'

describe('CHARACTER_BASICS_PROMPT', () => {
  it('asks the LLM to populate an identity field', () => {
    expect(CHARACTER_BASICS_PROMPT).toContain('"identity"')
  })

  it('mentions all four vantage-point labels (IDENTITY/DESCRIPTION/PERSONALITY/TITLE)', () => {
    expect(CHARACTER_BASICS_PROMPT).toContain('IDENTITY')
    expect(CHARACTER_BASICS_PROMPT).toContain('DESCRIPTION')
    expect(CHARACTER_BASICS_PROMPT).toContain('PERSONALITY')
    expect(CHARACTER_BASICS_PROMPT).toContain('TITLE')
  })

  it('description guidance forbids physical appearance and points at physicalDescriptions', () => {
    // The old prompt said "covering appearance, background, and current situation".
    expect(CHARACTER_BASICS_PROMPT).not.toMatch(/covering appearance/i)
    expect(CHARACTER_BASICS_PROMPT).toMatch(/NOT physical appearance/i)
    expect(CHARACTER_BASICS_PROMPT).toContain('physicalDescriptions')
  })

  it('personality guidance forbids putting outward behaviour or identity facts in personality', () => {
    expect(CHARACTER_BASICS_PROMPT).toMatch(/Never put outward behaviour someone else would observe/i)
    expect(CHARACTER_BASICS_PROMPT).toMatch(/Never put public-facing identity facts/i)
  })
})

describe('assembleQtapExport', () => {
  const baseStepResults: AIImportStepResults = {
    character_basics: {
      name: 'Test Character',
      title: 'The Wandering Scholar',
      identity: 'A travelling scholar known by sight in three duchies for her sapphire spectacles and her insistence on reading aloud to anyone who will listen.',
      description: 'Speaks slowly and with deliberate care; punctuates her sentences with a small nod, as though confirming each thought to herself before moving on.',
      personality: 'Believes that knowledge unshared is knowledge half-formed; quietly suspects she is more frightened of silence than she lets on.',
      scenario: 'A reading-room with afternoon sun across the desk.',
    },
  }

  it('writes identity onto the assembled character', () => {
    const result = assembleQtapExport(baseStepResults, false, false, '4.4-dev')
    const characters = result.data.characters as Array<Record<string, unknown>>
    expect(characters).toHaveLength(1)
    expect(characters[0].identity).toBe(baseStepResults.character_basics!.identity)
  })

  it('preserves description and personality alongside identity', () => {
    const result = assembleQtapExport(baseStepResults, false, false, '4.4-dev')
    const character = (result.data.characters as Array<Record<string, unknown>>)[0]
    expect(character.description).toBe(baseStepResults.character_basics!.description)
    expect(character.personality).toBe(baseStepResults.character_basics!.personality)
  })

  it('writes identity as null when the LLM omits it', () => {
    const stepResultsWithoutIdentity: AIImportStepResults = {
      character_basics: {
        name: 'Nameless',
      },
    }
    const result = assembleQtapExport(stepResultsWithoutIdentity, false, false, '4.4-dev')
    const character = (result.data.characters as Array<Record<string, unknown>>)[0]
    expect(character.identity).toBeNull()
  })
})
