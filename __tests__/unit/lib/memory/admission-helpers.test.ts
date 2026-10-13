/**
 * Admission's pure helpers.
 *
 * Covers:
 * - extractNovelDetails() — deterministic regex-based novel detail extraction
 * - calculateReinforcedImportance() — reinforced importance formula
 * - the admission thresholds and their order
 */

import { describe, it, expect } from '@jest/globals'
import { extractNovelDetails } from '@/lib/memory/admission'
import { calculateReinforcedImportance } from '@/lib/memory/scoring'
import { ADMISSION_THRESHOLDS } from '@/lib/memory/settings-defaults'

// =============================================================================
// extractNovelDetails()
// =============================================================================

describe('extractNovelDetails', () => {
  it('extracts proper nouns absent from existing content', () => {
    const candidate = 'She went to Paris with Marcus.'
    const existing = 'She went somewhere.'
    const result = extractNovelDetails(candidate, existing)

    expect(result).toContain('Paris')
    expect(result).toContain('Marcus')
  })

  it('extracts numbers with context absent from existing content', () => {
    const candidate = 'He is 25 years old and has been there for 3 months.'
    const existing = 'He is a person.'
    const result = extractNovelDetails(candidate, existing)

    expect(result).toEqual(
      expect.arrayContaining([
        expect.stringContaining('25 years'),
      ])
    )
  })

  it('extracts dates absent from existing content', () => {
    const candidate = 'The event is on 2024-01-15 at the park.'
    const existing = 'The event is at the park.'
    const result = extractNovelDetails(candidate, existing)

    expect(result).toContain('2024-01-15')
  })

  it('extracts currency amounts absent from existing content', () => {
    const candidate = 'It costs $1,234.56 to repair.'
    const existing = 'It costs a lot to repair.'
    const result = extractNovelDetails(candidate, existing)

    expect(result).toContain('$1,234.56')
  })

  it('returns empty when no novel details exist', () => {
    const content = 'She went somewhere yesterday.'
    const result = extractNovelDetails(content, content)

    expect(result).toEqual([])
  })

  it('filters out stop words and single-letter words', () => {
    // "The" at sentence start is skipped by index 0 logic.
    // "and", "or", "with" etc. are stop words. "A" is single-letter.
    const candidate = 'The cat sat. A dog and the bird with it.'
    const existing = 'Nothing relevant.'
    const result = extractNovelDetails(candidate, existing)

    // None of these common words should appear as proper nouns
    expect(result).not.toContain('The')
    expect(result).not.toContain('A')
    expect(result).not.toContain('And')
  })

  it('handles sentence-initial capitalization correctly', () => {
    // Words at the start of a sentence should NOT be treated as proper nouns
    const candidate = 'Running is fun. Walking is good too.'
    const existing = 'Exercise is important.'
    const result = extractNovelDetails(candidate, existing)

    // "Running" and "Walking" are sentence-initial, should not be detected as proper nouns
    expect(result).not.toContain('Running')
    expect(result).not.toContain('Walking')
  })

  it('extracts CamelCase technical terms', () => {
    const candidate = 'She is using TypeScript and JavaScript for the project.'
    const existing = 'She is working on a project.'
    const result = extractNovelDetails(candidate, existing)

    expect(result).toContain('TypeScript')
    expect(result).toContain('JavaScript')
  })

  it('extracts acronyms', () => {
    const candidate = 'The FBI investigated the case with help from the CIA.'
    const existing = 'Someone investigated the case.'
    const result = extractNovelDetails(candidate, existing)

    expect(result).toContain('FBI')
    expect(result).toContain('CIA')
  })

  it('does not extract details already present in existing content', () => {
    const candidate = 'She went to Paris with Marcus on 2024-01-15.'
    const existing = 'She went to Paris with Marcus on 2024-01-15.'
    const result = extractNovelDetails(candidate, existing)

    expect(result).toEqual([])
  })

  it('handles empty candidate content', () => {
    const result = extractNovelDetails('', 'Some existing content.')
    expect(result).toEqual([])
  })

  it('handles empty existing content', () => {
    const candidate = 'She met Marcus in Paris.'
    const result = extractNovelDetails(candidate, '')

    expect(result).toContain('Marcus')
    expect(result).toContain('Paris')
  })
})

// =============================================================================
// calculateReinforcedImportance()
// =============================================================================

describe('calculateReinforcedImportance', () => {
  // Bug 216 / locked decision 6: min(1, i + log2(n) * 0.05), so count 1 equals importance.
  it.each([0, 0.1, 0.3, 0.5, 0.65, 0.9, 1.0])('equals importance at reinforcementCount=1 (i=%p)', (i) => {
    expect(calculateReinforcedImportance(i, 1)).toBeCloseTo(i, 10)
  })

  it('adds one step per doubling of the count', () => {
    // base 0.5, count 2 -> 0.5 + log2(2) * 0.05 = 0.55
    expect(calculateReinforcedImportance(0.5, 2)).toBeCloseTo(0.55, 10)
    // count 4 -> 0.6
    expect(calculateReinforcedImportance(0.5, 4)).toBeCloseTo(0.6, 10)
  })

  it('calculates correctly for reinforcementCount=10 and stays below 1.0', () => {
    const result = calculateReinforcedImportance(0.5, 10)
    expect(result).toBeCloseTo(0.5 + Math.log2(10) * 0.05, 10)
    expect(result).toBeLessThan(1.0)
  })

  it('caps at 1.0 for large count with high base importance', () => {
    const result = calculateReinforcedImportance(0.9, 100)
    expect(result).toBe(1.0)
  })

  it('treats a count below 1 as 1 (no negative bonus)', () => {
    expect(calculateReinforcedImportance(0.5, 0)).toBeCloseTo(0.5, 10)
    expect(calculateReinforcedImportance(0.5, -3)).toBeCloseTo(0.5, 10)
    expect(calculateReinforcedImportance(0.5, Number.NaN)).toBeCloseTo(0.5, 10)
  })

  it('handles base importance of 0', () => {
    const result = calculateReinforcedImportance(0, 6)
    expect(result).toBeCloseTo(Math.log2(6) * 0.05, 10)
    expect(result).toBeGreaterThan(0)
  })

  it('handles base importance of 1.0 (already at cap)', () => {
    const result = calculateReinforcedImportance(1.0, 10)
    expect(result).toBe(1.0)
  })
})

// =============================================================================
// Thresholds
// =============================================================================

describe('admission thresholds', () => {
  it('pins the values', () => {
    expect(ADMISSION_THRESHOLDS.reinforce).toBe(0.85)
    expect(ADMISSION_THRESHOLDS.nearDuplicate).toBe(0.90)
    expect(ADMISSION_THRESHOLDS.related).toBe(0.70)
    expect(ADMISSION_THRESHOLDS.dateGuardDays).toBe(7)
    expect(ADMISSION_THRESHOLDS.footnoteCap).toBe(8)
  })

  it('orders related < reinforce < nearDuplicate', () => {
    expect(ADMISSION_THRESHOLDS.reinforce).toBeGreaterThan(ADMISSION_THRESHOLDS.related)
    expect(ADMISSION_THRESHOLDS.nearDuplicate).toBeGreaterThan(ADMISSION_THRESHOLDS.reinforce)
  })
})
