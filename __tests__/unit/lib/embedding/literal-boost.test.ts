import { describe, it, expect } from '@jest/globals'

import {
  LITERAL_BOOST_MIN_PHRASE_LENGTH,
  applyLiteralBoost,
  containsLiteralPhrase,
  getLiteralPhrase,
} from '@/lib/embedding/literal-boost'

describe('literal-boost utilities', () => {
  describe('LITERAL_BOOST_MIN_PHRASE_LENGTH', () => {
    it('is 8 (the agreed-upon noise floor)', () => {
      // Pinned constant — if this changes, the search-tool contract changes
      // and tests across document/conversation/memory/help paths need to
      // be re-checked.
      expect(LITERAL_BOOST_MIN_PHRASE_LENGTH).toBe(8)
    })
  })

  describe('getLiteralPhrase', () => {
    it('returns the trimmed lowercased phrase when length ≥ 8', () => {
      expect(getLiteralPhrase('Sunlit Archives')).toBe('sunlit archives')
    })

    it('trims surrounding whitespace before measuring length', () => {
      // 'archives' is exactly 8 chars; surrounding whitespace must not
      // disqualify a query that would otherwise pass.
      expect(getLiteralPhrase('   archives   ')).toBe('archives')
    })

    it('returns null when the trimmed phrase is below the minimum', () => {
      expect(getLiteralPhrase('cat')).toBeNull()
      expect(getLiteralPhrase('       ')).toBeNull()
      expect(getLiteralPhrase('')).toBeNull()
    })

    it('returns null for nullish input', () => {
      expect(getLiteralPhrase(null)).toBeNull()
      expect(getLiteralPhrase(undefined)).toBeNull()
    })

    it('treats exactly 8 characters as qualifying', () => {
      // Boundary: ≥ 8, not > 8.
      expect(getLiteralPhrase('archives')).toBe('archives')
    })
  })

  describe('containsLiteralPhrase', () => {
    it('matches case-insensitively', () => {
      expect(containsLiteralPhrase('THE SUNLIT ARCHIVES', 'sunlit archives')).toBe(true)
    })

    it('returns false when the phrase is not present', () => {
      expect(containsLiteralPhrase('A note about libraries.', 'sunlit archives')).toBe(false)
    })

    it('returns false for null/undefined/empty text', () => {
      expect(containsLiteralPhrase(null, 'sunlit archives')).toBe(false)
      expect(containsLiteralPhrase(undefined, 'sunlit archives')).toBe(false)
      expect(containsLiteralPhrase('', 'sunlit archives')).toBe(false)
    })
  })

  describe('applyLiteralBoost', () => {
    it('lifts a score halfway to 1.0', () => {
      // Intent: 0.5 → 0.75 (the reference example from the spec).
      expect(applyLiteralBoost(0.5)).toBeCloseTo(0.75, 10)
      expect(applyLiteralBoost(0.8)).toBeCloseTo(0.9, 10)
      expect(applyLiteralBoost(0.0)).toBeCloseTo(0.5, 10)
    })

    it('leaves a perfect score (1.0) unchanged', () => {
      // Distance to 1.0 is zero; boost is the identity at the ceiling.
      expect(applyLiteralBoost(1.0)).toBeCloseTo(1.0, 10)
    })
  })
})
