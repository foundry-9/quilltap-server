/**
 * Unit tests for the mentioned-characters module — scans a chat corpus for
 * references to characters that exist on the system but are not currently in
 * the chat, and formats them into a "Characters Mentioned" system-prompt
 * section.
 */

import { describe, it, expect } from '@jest/globals'
import {
  findMentionedCharacterIds,
  formatMentionedCharactersSection,
} from '@/lib/chat/context/mentioned-characters'
import type { Character } from '@/lib/schemas/types'

// Minimal Character builder — only the fields the module reads.
function makeCharacter(overrides: Partial<Character> & { id: string; name: string }): Character {
  return {
    id: overrides.id,
    userId: 'user-1',
    name: overrides.name,
    aliases: overrides.aliases ?? [],
    description: overrides.description ?? null,
    pronouns: overrides.pronouns ?? null,
    scenarios: [],
    systemPrompts: [],
    isFavorite: false,
    npc: false,
    talkativeness: 0.5,
    controlledBy: 'llm',
    partnerLinks: [],
    tags: [],
    avatarOverrides: [],
    physicalDescriptions: [],
    clothingRecords: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  } as Character
}

describe('findMentionedCharacterIds', () => {
  it('returns empty when corpus is empty', () => {
    const characters = [makeCharacter({ id: 'a', name: 'Alice' })]
    expect(findMentionedCharacterIds('', characters).size).toBe(0)
  })

  it('returns empty when there are no candidates', () => {
    expect(findMentionedCharacterIds('Alice and Bob walked in.', []).size).toBe(0)
  })

  it('matches a single name with word boundaries (case-insensitive)', () => {
    const alice = makeCharacter({ id: 'a', name: 'Alice' })
    const result = findMentionedCharacterIds('Have you seen alice today?', [alice])
    expect(Array.from(result)).toEqual(['a'])
  })

  it('does NOT match when the name is a substring of a longer word', () => {
    const al = makeCharacter({ id: 'a', name: 'Alice' })
    const result = findMentionedCharacterIds('Alicia knocked at the door.', [al])
    expect(result.size).toBe(0)
  })

  it('matches via an alias', () => {
    const alice = makeCharacter({
      id: 'a',
      name: 'Alice Tremaine',
      aliases: ['Allie', 'Tremaine'],
    })
    const result = findMentionedCharacterIds('Allie was missing.', [alice])
    expect(Array.from(result)).toEqual(['a'])
  })

  it('matches multi-word names as a phrase', () => {
    const john = makeCharacter({ id: 'j', name: 'John Smith' })
    const result = findMentionedCharacterIds('Then John Smith arrived.', [john])
    expect(Array.from(result)).toEqual(['j'])
  })

  it('does not match split fragments of a multi-word name', () => {
    const john = makeCharacter({ id: 'j', name: 'John Smith' })
    // Plain "John" alone should not trigger a match for "John Smith"
    const result = findMentionedCharacterIds('John walked away.', [john])
    expect(result.size).toBe(0)
  })

  it('escapes regex metacharacters in names', () => {
    const obrien = makeCharacter({ id: 'o', name: "Mr. O'Brien" })
    const corpus = "I bumped into Mr. O'Brien at the docks."
    const result = findMentionedCharacterIds(corpus, [obrien])
    expect(Array.from(result)).toEqual(['o'])
  })

  it('returns multiple matches across different characters', () => {
    const alice = makeCharacter({ id: 'a', name: 'Alice' })
    const bob = makeCharacter({ id: 'b', name: 'Bob' })
    const carol = makeCharacter({ id: 'c', name: 'Carol' })
    const corpus = 'Alice told Bob a story. Carol laughed.'
    const result = findMentionedCharacterIds(corpus, [alice, bob, carol])
    expect(Array.from(result).sort()).toEqual(['a', 'b', 'c'])
  })

  it('deduplicates when the same character is named multiple times', () => {
    const alice = makeCharacter({
      id: 'a',
      name: 'Alice',
      aliases: ['Allie'],
    })
    const corpus = 'Alice waved. Then Allie waved again. Alice smiled.'
    const result = findMentionedCharacterIds(corpus, [alice])
    expect(Array.from(result)).toEqual(['a'])
  })

  it('honors caller-supplied exclusions (caller filters candidates)', () => {
    const alice = makeCharacter({ id: 'a', name: 'Alice' })
    const bob = makeCharacter({ id: 'b', name: 'Bob' })
    // Caller has already removed Alice from candidates.
    const result = findMentionedCharacterIds('Alice told Bob.', [bob])
    expect(Array.from(result)).toEqual(['b'])
  })
})

describe('formatMentionedCharactersSection', () => {
  it('returns empty section for empty input', () => {
    const result = formatMentionedCharactersSection([])
    expect(result.section).toBe('')
    expect(result.includedCount).toBe(0)
  })

  it('renders name, aliases, pronouns, and full description', () => {
    const alice = makeCharacter({
      id: 'a',
      name: 'Alice Tremaine',
      aliases: ['Allie', 'Tremaine'],
      pronouns: { subject: 'she', object: 'her', possessive: 'hers' },
      description: 'A solicitor with an unfortunate habit of arriving late.',
    })
    const result = formatMentionedCharactersSection([alice])
    expect(result.section).toContain('## Characters Mentioned')
    expect(result.section).toContain('### Alice Tremaine')
    expect(result.section).toContain('Aliases: Allie, Tremaine')
    expect(result.section).toContain('Pronouns: she/her/hers')
    expect(result.section).toContain('A solicitor with an unfortunate habit of arriving late.')
    expect(result.includedCount).toBe(1)
  })

  it('includes the full description even when very long', () => {
    const longDesc = 'lorem ipsum '.repeat(200).trim() // ~2400 chars
    const c = makeCharacter({ id: 'a', name: 'Alice', description: longDesc })
    const result = formatMentionedCharactersSection([c])
    expect(result.section).toContain(longDesc)
    expect(result.section).not.toMatch(/…/)
  })

  it('omits pronouns/aliases/description fields when missing', () => {
    const c = makeCharacter({ id: 'a', name: 'Bare' })
    const result = formatMentionedCharactersSection([c])
    expect(result.section).toContain('### Bare')
    expect(result.section).not.toContain('Aliases:')
    expect(result.section).not.toContain('Pronouns:')
  })

  it('renders multiple characters in alphabetical order', () => {
    const characters = [
      makeCharacter({ id: 'c', name: 'Carol' }),
      makeCharacter({ id: 'a', name: 'Alice' }),
      makeCharacter({ id: 'b', name: 'Bob' }),
    ]
    const result = formatMentionedCharactersSection(characters)
    const aIdx = result.section.indexOf('### Alice')
    const bIdx = result.section.indexOf('### Bob')
    const cIdx = result.section.indexOf('### Carol')
    expect(aIdx).toBeGreaterThan(-1)
    expect(bIdx).toBeGreaterThan(aIdx)
    expect(cIdx).toBeGreaterThan(bIdx)
  })

  it('includes every matched character without dropping any', () => {
    const longDesc = 'A truly extraordinary creature. '.repeat(15).trim()
    const characters = Array.from({ length: 80 }, (_, i) =>
      makeCharacter({
        id: `id-${i}`,
        name: `Character ${String(i).padStart(2, '0')}`,
        description: longDesc,
      })
    )
    const result = formatMentionedCharactersSection(characters)
    expect(result.includedCount).toBe(characters.length)
    expect(result.section).not.toMatch(/more mentioned characters/)
    for (let i = 0; i < characters.length; i++) {
      expect(result.section).toContain(`### Character ${String(i).padStart(2, '0')}`)
    }
  })
})
