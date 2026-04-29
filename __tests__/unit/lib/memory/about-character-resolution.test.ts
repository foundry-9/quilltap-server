import { describe, expect, it } from '@jest/globals'
import {
  USER_GENERIC_ALIASES,
  countNameOccurrences,
  nameAppears,
  namesForAboutCharacter,
  namesForHolder,
  resolveAboutCharacterId,
} from '@/lib/memory/about-character-resolution'

describe('about-character-resolution', () => {
  describe('nameAppears', () => {
    it('matches names case-insensitively at word boundaries', () => {
      expect(nameAppears(['Charlie'], 'charlie laughed loudly')).toBe(true)
      expect(nameAppears(['Charlie'], 'CHARLIE laughed loudly')).toBe(true)
      expect(nameAppears(['Charlie'], 'A charlie-bravo signal')).toBe(true)
    })

    it('does not match substrings inside other words', () => {
      // "Amy" inside "amyrtaeus" must not register
      expect(nameAppears(['Amy'], 'amyrtaeus was a pharaoh')).toBe(false)
      // "User" inside "username" must not register
      expect(nameAppears(['user'], 'pick a username and password')).toBe(false)
    })

    it('returns false on empty inputs', () => {
      expect(nameAppears([], 'whatever')).toBe(false)
      expect(nameAppears(['Charlie'], '')).toBe(false)
      expect(nameAppears(['', '   '], 'Charlie laughed')).toBe(false)
    })

    it('matches when the name is followed by punctuation', () => {
      expect(nameAppears(['Friday'], 'Friday, the assistant, observed.')).toBe(true)
      expect(nameAppears(['Friday'], 'It was Friday.')).toBe(true)
    })
  })

  describe('namesForAboutCharacter', () => {
    it('returns name + aliases for non-user characters', () => {
      const names = namesForAboutCharacter({
        name: 'Friday',
        aliases: ['Fri', 'F.'],
        controlledBy: 'llm',
      })
      expect(names).toEqual(['Friday', 'Fri', 'F.'])
      expect(names).not.toContain('user')
    })

    it('augments user-controlled characters with generic user aliases', () => {
      const names = namesForAboutCharacter({
        name: 'Charlie',
        aliases: ['Chuck'],
        controlledBy: 'user',
      })
      expect(names).toEqual(['Charlie', 'Chuck', ...USER_GENERIC_ALIASES])
    })

    it('drops empty/whitespace-only aliases', () => {
      const names = namesForAboutCharacter({
        name: 'Friday',
        aliases: ['', '   ', 'Fri'],
        controlledBy: 'llm',
      })
      expect(names).toEqual(['Friday', 'Fri'])
    })
  })

  describe('resolveAboutCharacterId', () => {
    it('leaves null aboutCharacterId unchanged (caller decides)', () => {
      const result = resolveAboutCharacterId({
        holderCharacterId: 'friday',
        proposedAboutCharacterId: null,
        proposedAboutCharacter: null,
        text: 'Friday felt tired.',
      })
      expect(result).toEqual({ aboutCharacterId: null, flipped: false })
    })

    it('passes through self-references unchanged', () => {
      const result = resolveAboutCharacterId({
        holderCharacterId: 'friday',
        proposedAboutCharacterId: 'friday',
        proposedAboutCharacter: { name: 'Friday', aliases: [], controlledBy: 'llm' },
        text: 'something irrelevant',
      })
      expect(result).toEqual({ aboutCharacterId: 'friday', flipped: false })
    })

    it('keeps the proposed about-character when its name appears in text', () => {
      const result = resolveAboutCharacterId({
        holderCharacterId: 'friday',
        proposedAboutCharacterId: 'charlie',
        proposedAboutCharacter: { name: 'Charlie', aliases: ['Chuck'], controlledBy: 'user' },
        text: 'Charlie laughed at the joke.',
      })
      expect(result).toEqual({ aboutCharacterId: 'charlie', flipped: false })
    })

    it('keeps the proposed about-character when an alias appears', () => {
      const result = resolveAboutCharacterId({
        holderCharacterId: 'friday',
        proposedAboutCharacterId: 'charlie',
        proposedAboutCharacter: { name: 'Charlie', aliases: ['Chuck'], controlledBy: 'llm' },
        text: 'Chuck nodded thoughtfully.',
      })
      expect(result).toEqual({ aboutCharacterId: 'charlie', flipped: false })
    })

    it('keeps user-controlled about-character when generic "user" appears', () => {
      const result = resolveAboutCharacterId({
        holderCharacterId: 'friday',
        proposedAboutCharacterId: 'charlie',
        proposedAboutCharacter: { name: 'Charlie', aliases: [], controlledBy: 'user' },
        text: 'The user mentioned they like jazz.',
      })
      expect(result).toEqual({ aboutCharacterId: 'charlie', flipped: false })
    })

    it('does NOT treat "user" as an alias for non-user-controlled characters', () => {
      const result = resolveAboutCharacterId({
        holderCharacterId: 'friday',
        proposedAboutCharacterId: 'amy',
        proposedAboutCharacter: { name: 'Amy', aliases: [], controlledBy: 'llm' },
        text: 'The user laughed at something.',
      })
      // Amy is LLM-controlled; "user" is not her alias. With no Amy reference,
      // the safety net flips this to a self-reference on the holder.
      expect(result).toEqual({ aboutCharacterId: 'friday', flipped: true })
    })

    it('flips to holder when about-character name is absent', () => {
      const result = resolveAboutCharacterId({
        holderCharacterId: 'friday',
        proposedAboutCharacterId: 'charlie',
        proposedAboutCharacter: { name: 'Charlie', aliases: ['Chuck'], controlledBy: 'user' },
        text: 'Friday adjusted her glasses thoughtfully and considered the question.',
      })
      expect(result).toEqual({ aboutCharacterId: 'friday', flipped: true })
    })

    it('passes through unchanged when proposed about-character data is unavailable', () => {
      // Migration calls this when the about-character was deleted; we can't
      // disprove the attribution, so leave it alone.
      const result = resolveAboutCharacterId({
        holderCharacterId: 'friday',
        proposedAboutCharacterId: 'ghost',
        proposedAboutCharacter: null,
        text: 'Friday remembered something important.',
      })
      expect(result).toEqual({ aboutCharacterId: 'ghost', flipped: false })
    })

    it('honours the both-names-present rule when neither dominates (about-character wins on ties)', () => {
      // Each named once → ties go to the about-character (Q3 policy).
      const result = resolveAboutCharacterId({
        holderCharacterId: 'friday',
        holderCharacter: { name: 'Friday', aliases: [] },
        proposedAboutCharacterId: 'charlie',
        proposedAboutCharacter: { name: 'Charlie', aliases: [], controlledBy: 'user' },
        text: 'Friday and Charlie shared a laugh together.',
      })
      expect(result).toEqual({ aboutCharacterId: 'charlie', flipped: false })
    })

    describe('holder-dominance tiebreaker (v2)', () => {
      it('flips to holder when the holder is named more often than the about-character', () => {
        // Real example from the production data: "Friday calls the current
        // moment a 'hinge' and urges Charlie to switch on the fix to
        // re-attribute her 6,000+ memories to her name." Friday × 1, Charlie
        // × 1 — but the summary line "Friday identifies this as a pivotal
        // 'hinge' moment and calls for the memory fix" pushes Friday to ≥2.
        const result = resolveAboutCharacterId({
          holderCharacterId: 'friday',
          holderCharacter: { name: 'Friday', aliases: [] },
          proposedAboutCharacterId: 'charlie',
          proposedAboutCharacter: { name: 'Charlie', aliases: [], controlledBy: 'user' },
          text:
            "Friday identifies this as a pivotal 'hinge' moment and calls for the memory fix.\n" +
            "Friday calls the current moment a 'hinge' and urges Charlie to switch on the fix.",
        })
        expect(result).toEqual({
          aboutCharacterId: 'friday',
          flipped: true,
          reason: 'holder-dominates',
        })
      })

      it('keeps about-character on a tie (1 vs 1)', () => {
        const result = resolveAboutCharacterId({
          holderCharacterId: 'friday',
          holderCharacter: { name: 'Friday', aliases: [] },
          proposedAboutCharacterId: 'charlie',
          proposedAboutCharacter: { name: 'Charlie', aliases: [], controlledBy: 'llm' },
          text: 'Friday handed Charlie the ledger.',
        })
        expect(result).toEqual({ aboutCharacterId: 'charlie', flipped: false })
      })

      it('keeps about-character when about-character dominates', () => {
        const result = resolveAboutCharacterId({
          holderCharacterId: 'friday',
          holderCharacter: { name: 'Friday', aliases: [] },
          proposedAboutCharacterId: 'charlie',
          proposedAboutCharacter: { name: 'Charlie', aliases: [], controlledBy: 'llm' },
          text: 'Charlie spoke at length about Charlie. Friday listened.',
        })
        expect(result).toEqual({ aboutCharacterId: 'charlie', flipped: false })
      })

      it('does not run when holderCharacter is omitted (legacy / deleted-holder)', () => {
        // No holderCharacter supplied → tiebreaker can't run; only the
        // presence rule applies. Charlie is named, so attribution stays.
        const result = resolveAboutCharacterId({
          holderCharacterId: 'friday',
          proposedAboutCharacterId: 'charlie',
          proposedAboutCharacter: { name: 'Charlie', aliases: [], controlledBy: 'user' },
          text: 'Friday Friday Friday but Charlie too.',
        })
        expect(result).toEqual({ aboutCharacterId: 'charlie', flipped: false })
      })

      it('counts holder aliases (but never USER_GENERIC_ALIASES) toward holder dominance', () => {
        // Friday's aliases include "Fri." Generic "user" is not counted for
        // the holder regardless of holder type, so we don't double-count
        // when the holder happens to be a user-controlled persona.
        const result = resolveAboutCharacterId({
          holderCharacterId: 'friday',
          holderCharacter: { name: 'Friday', aliases: ['Fri'] },
          proposedAboutCharacterId: 'charlie',
          proposedAboutCharacter: { name: 'Charlie', aliases: [], controlledBy: 'llm' },
          text: 'Fri smiled. Friday nodded. Charlie watched.',
        })
        expect(result).toEqual({
          aboutCharacterId: 'friday',
          flipped: true,
          reason: 'holder-dominates',
        })
      })
    })
  })

  describe('countNameOccurrences', () => {
    it('counts case-insensitive word-boundary hits and sums across names', () => {
      expect(countNameOccurrences(['Friday'], 'Friday and FRIDAY and friday.')).toBe(3)
      expect(countNameOccurrences(['Friday', 'Fri'], 'Fri smiled. Friday nodded.')).toBe(2)
    })

    it('does not count substring matches inside other words', () => {
      expect(countNameOccurrences(['Amy'], 'amyrtaeus was Amy adjacent.')).toBe(1)
      expect(countNameOccurrences(['user'], 'a username and the user.')).toBe(1)
    })

    it('returns 0 on empty inputs', () => {
      expect(countNameOccurrences([], 'whatever')).toBe(0)
      expect(countNameOccurrences(['Friday'], '')).toBe(0)
    })
  })

  describe('namesForHolder', () => {
    it('does not include USER_GENERIC_ALIASES even for user-controlled characters', () => {
      const names = namesForHolder({ name: 'Charlie', aliases: ['Chuck'] })
      expect(names).toEqual(['Charlie', 'Chuck'])
      for (const generic of USER_GENERIC_ALIASES) {
        expect(names).not.toContain(generic)
      }
    })
  })
})
