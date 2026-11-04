/**
 * Character kind — the resolver every reader goes through.
 *
 * @jest-environment node
 */

import {
  CHARACTER_KINDS,
  DEFAULT_CHARACTER_KIND,
  characterKindOrDefault,
  isAssistantCharacter,
  resolveCharacterKind,
} from '@/lib/characters/kind'

describe('character kind', () => {
  it('defaults to roleplay', () => {
    expect(DEFAULT_CHARACTER_KIND).toBe('roleplay')
    expect(CHARACTER_KINDS).toEqual(['roleplay', 'assistant'])
  })

  it.each([
    ['roleplay', 'roleplay'],
    ['assistant', 'assistant'],
    [undefined, 'roleplay'],
    [null, 'roleplay'],
    ['', 'roleplay'],
    ['Assistant', 'roleplay'],
    ['butler', 'roleplay'],
    [1, 'roleplay'],
  ])('normalizes %p to %p', (value, expected) => {
    expect(characterKindOrDefault(value)).toBe(expected)
  })

  it('resolves a character with no kind (a raw row, a pre-kind vault) as roleplay', () => {
    expect(resolveCharacterKind({})).toBe('roleplay')
    expect(resolveCharacterKind(null)).toBe('roleplay')
    expect(resolveCharacterKind(undefined)).toBe('roleplay')
  })

  it('resolves a stored kind', () => {
    expect(resolveCharacterKind({ kind: 'assistant' })).toBe('assistant')
    expect(resolveCharacterKind({ kind: 'roleplay' })).toBe('roleplay')
  })

  it('answers whether a character is an assistant', () => {
    expect(isAssistantCharacter({ kind: 'assistant' })).toBe(true)
    expect(isAssistantCharacter({ kind: 'roleplay' })).toBe(false)
    expect(isAssistantCharacter({ kind: 'wizard' })).toBe(false)
    expect(isAssistantCharacter(null)).toBe(false)
  })
})
