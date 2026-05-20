/**
 * Unit tests for the mentioned-characters module — scans a chat corpus for
 * references to characters that exist on the system but are not currently in
 * the chat. Hits drive the Host's off-scene-character introduction (posted
 * once per character to chat history); the legacy "Characters Mentioned"
 * system-prompt section was retired.
 */

import { describe, it, expect } from '@jest/globals'
import {
  findMentionedCharacterIds,
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

// `formatMentionedCharactersSection` and its tests were retired when off-scene
// character cards moved out of the system prompt and into Host-authored
// chat-history introductions. See `buildOffSceneCharactersContent` and its
// tests in `__tests__/unit/lib/services/host-notifications-phase-c.test.ts`
// for the equivalent coverage.
